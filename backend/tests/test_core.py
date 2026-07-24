from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harvester.archiver import Archiver
from harvester.auto_archive import AutoArchiveManager
from harvester.cache import PersistentKernelMetadataCache
from harvester.kaggle_client import (
    _extract_public_score,
    _extract_current_public_score,
    _infer_score_direction_from_metric,
    _locate_utf8_wrapper,
    _parse_public_score,
)
from harvester.kaggle_client import KaggleClient
from harvester.models import (
    ArchiverConfig,
    AutoArchiveCheckedItem,
    AutoArchiveConfig,
    AutoArchiveRunLog,
    CompetitionInfo,
    KernelSummary,
    NotificationConfigUpdate,
    ScoredKernel,
    VersionInfo,
    VersionScoreList,
)
from harvester.notifications import NotificationManager
from harvester.notifications import _format_beijing_time


class FakeSecretStore:
    storage_mode = "session"

    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, key: str) -> str:
        return self.values.get(key, "")

    def update(self, values: dict[str, str | None]) -> None:
        for key, value in values.items():
            if value:
                self.values[key] = value
            else:
                self.values.pop(key, None)


class FakeKaggleClient:
    competition_slug = "example-competition"

    def __init__(self, scored: bool = True) -> None:
        self.calls = 0
        self.version_calls = 0
        self.runtime_metadata_calls = 0
        self.scored = scored

    def get_kernel_runtime_metadata(
        self, kernel_ref: str, version_number: int
    ) -> dict:
        self.runtime_metadata_calls += 1
        return {
            "enableGpu": True,
            "enableInternet": False,
            "machineShape": "Gpu",
            "runtimeMetadataSource": "kaggle_sdk_version",
            "runtimeMetadataVersion": version_number,
        }

    def get_kernel_versions(
        self, kernel_ref: str, refresh: bool = False
    ) -> VersionScoreList:
        self.version_calls += 1
        owner, slug = kernel_ref.split("/", 1)
        scores = (7.1, 6.9) if self.scored else (None, None)
        return VersionScoreList(
            owner_slug=owner,
            kernel_slug=slug,
            versions=[
                VersionInfo(
                    version_number=1,
                    title="v1",
                    status="complete",
                    date_created="2026-01-01T00:00:00Z",
                    public_lb_numeric=scores[0],
                ),
                VersionInfo(
                    version_number=2,
                    title="v2",
                    status="complete",
                    date_created="2026-01-02T00:00:00Z",
                    public_lb_numeric=scores[1],
                ),
            ],
        )

    def archive_kernel(
        self,
        kernel_ref: str,
        output_dir: str,
        version: int | None = None,
        include_outputs: bool = False,
    ) -> dict:
        self.calls += 1
        selected_version = version or 2
        path = Path(output_dir)
        path.mkdir(parents=True, exist_ok=True)
        metadata = {
            "title": "示例 Kernel",
            "versionNumber": selected_version,
            "scriptVersionId": 123,
            "datasetSources": ["owner/data"],
        }
        (path / "kernel-metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False), encoding="utf-8"
        )
        (path / "sample.ipynb").write_text("{}", encoding="utf-8")
        if include_outputs:
            (path / "result.csv").write_text("value\n1\n", encoding="utf-8")
        return {
            "selected_version": selected_version,
            "script_version_id": 123,
            "source_path": str(path / "sample.ipynb"),
            "metadata": metadata,
        }


class FakeAutoArchiveKaggleClient(FakeKaggleClient):
    def __init__(self, is_lower_better: bool = True) -> None:
        super().__init__()
        self.is_lower_better = is_lower_better

    def fetch_competition_info(
        self, competition: str, refresh: bool = False
    ) -> CompetitionInfo:
        return CompetitionInfo(
            id=competition,
            title=competition,
            category="featured",
            is_lower_better=self.is_lower_better,
            score_direction_source="leaderboard",
        )

    def list_kernels(self, **kwargs) -> list[KernelSummary]:
        self.list_kwargs = kwargs
        return [
            KernelSummary(
                ref="owner/kernel",
                title="命中",
                author="owner",
                last_run_time="2026-01-03T00:00:00Z",
            ),
            KernelSummary(
                ref="owner/equal",
                title="等于阈值",
                author="owner",
                last_run_time="2026-01-03T00:00:00Z",
            ),
            KernelSummary(
                ref="owner/high",
                title="高于阈值",
                author="owner",
                last_run_time="2026-01-03T00:00:00Z",
            ),
        ]

    def enrich_kernel_summaries(
        self, summaries, competition: str, score_limit: int
    ) -> list[ScoredKernel]:
        scores = {
            "owner/kernel": 6.95,
            "owner/equal": 7.0,
            "owner/high": 7.1,
        }
        return [
            ScoredKernel(
                ref=item.ref,
                title=item.title,
                author=item.author,
                public_score=scores[item.ref],
                last_run_time=item.last_run_time,
                competition=competition,
            )
            for item in summaries[:score_limit]
        ]


class ScoreParserTests(unittest.TestCase):
    def test_parse_public_score(self) -> None:
        self.assertEqual(_parse_public_score("6.93900"), 6.939)
        self.assertEqual(_parse_public_score("score: 1,234.50"), 1234.5)
        self.assertIsNone(_parse_public_score("N/A"))

    def test_metric_direction_inference(self) -> None:
        self.assertTrue(_infer_score_direction_from_metric("RMSE"))
        self.assertFalse(_infer_score_direction_from_metric("ROC AUC"))
        self.assertIsNone(_infer_score_direction_from_metric("Custom Score"))

    def test_extract_public_score_prefers_kaggle_best_score(self) -> None:
        view = {
            "bestSubmissionScore": {"scoreFormatted": "6.939"},
            "kernel": {"bestPublicScore": 7.01},
            "submission": {"scoreFormatted": "7.100"},
        }
        self.assertEqual(_extract_public_score(view), 6.939)

    def test_extract_public_score_uses_compatible_fallbacks(self) -> None:
        self.assertEqual(
            _extract_public_score({"kernel": {"bestPublicScore": 7.01}}),
            7.01,
        )
        self.assertEqual(
            _extract_public_score({"submission": {"scoreFormatted": "7.100"}}),
            7.1,
        )

    def test_current_score_prefers_best_score_not_latest_submission(self) -> None:
        score, score_version, current_version = _extract_current_public_score({
            "currentVersionNumber": 59,
            "bestSubmissionScore": {
                "kernelVersionNumber": 58,
                "scoreFormatted": "7.004",
            },
            "submission": {"scoreFormatted": None},
        })
        self.assertEqual(score, 7.004)
        self.assertEqual(score_version, 58)
        self.assertEqual(current_version, 59)

        # 最新版已有公开分但更差时，列表仍应展示 Best Score。
        score, score_version, current_version = _extract_current_public_score({
            "currentVersionNumber": 2,
            "bestSubmissionScore": {
                "kernelVersionNumber": 1,
                "scoreFormatted": "6.390",
            },
            "submission": {"scoreFormatted": "6.465"},
            "kernel": {"bestPublicScore": 6.39},
        })
        self.assertEqual(score, 6.39)
        self.assertEqual(score_version, 1)
        self.assertEqual(current_version, 2)

        score, score_version, current_version = _extract_current_public_score({
            "currentVersionNumber": 59,
            "bestSubmissionScore": {
                "kernelVersionNumber": 59,
                "scoreFormatted": "6.979",
            },
        })
        self.assertEqual(score, 6.979)
        self.assertEqual(score_version, 59)
        self.assertEqual(current_version, 59)


class KernelScoreSortTests(unittest.TestCase):
    def test_utf8_wrapper_lookup_accepts_shallow_container_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            module_file = Path(temp_dir) / "app" / "harvester" / "kaggle_client.py"
            module_file.parent.mkdir(parents=True)
            module_file.touch()

            wrapper = _locate_utf8_wrapper(module_file)

            self.assertEqual(
                wrapper,
                module_file.parent / "Invoke-KaggleUtf8.ps1",
            )

    def test_score_sort_uses_sdk_path_instead_of_vote_list(self) -> None:
        client = KaggleClient()
        expected = [
            KernelSummary(ref="owner/best", title="Best", author="owner")
        ]
        calls: list[dict] = []

        def fake_score_list(**kwargs):
            calls.append(kwargs)
            return expected

        client._list_kernels_by_score_sdk = fake_score_list  # type: ignore[method-assign]
        result = client.list_kernels(
            sort_by="scoreAscending",
            page_size=50,
            max_pages=1,
            competition="example",
        )

        self.assertEqual(result, expected)
        self.assertEqual(calls[0]["competition"], "example")
        self.assertFalse(calls[0]["descending"])


class KernelMetadataEnrichmentTests(unittest.TestCase):
    def test_new_kernel_type_is_fetched_once_then_reused_from_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = PersistentKernelMetadataCache(temp_dir)
            client = KaggleClient(metadata_cache=cache)
            calls: list[str] = []

            def fake_fetch(ref: str) -> str:
                calls.append(ref)
                return "notebook"

            client._fetch_kernel_type_sdk = fake_fetch  # type: ignore[method-assign]
            first = [ScoredKernel(ref="owner/kernel", title="Kernel", author="owner")]
            self.assertTrue(client.enrich_kernel_metadata(first))
            self.assertEqual(first[0].kernel_type, "notebook")
            self.assertEqual(calls, ["owner/kernel"])

            restored_client = KaggleClient(
                metadata_cache=PersistentKernelMetadataCache(temp_dir)
            )
            restored_client._fetch_kernel_type_sdk = (  # type: ignore[method-assign]
                lambda ref: self.fail(f"不应重复请求类型：{ref}")
            )
            second = [ScoredKernel(ref="owner/kernel", title="Kernel", author="owner")]
            self.assertTrue(restored_client.enrich_kernel_metadata(second))
            self.assertEqual(second[0].kernel_type, "notebook")


class KernelLocalDownloadTests(unittest.TestCase):
    def test_historical_version_and_outputs_are_saved_locally(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = KaggleClient()
            class FakeWebService:
                def __init__(self, token: str) -> None:
                    pass

                def post(self, method: str, body: dict):
                    if method.endswith("GetKernelViewModel"):
                        if "versionNumber" in body:
                            return {
                                "kernel": {"id": 123, "title": "示例 Kernel"},
                                "kernelRun": {"language": "python"},
                                "downloadAllFilesUrl": "/code/svzip/456",
                                "dataSources": [
                                    {"mountSlug": "datasets/owner/data"},
                                    {"mountSlug": "competitions/example"},
                                ],
                            }
                        return {
                            "kernel": {"id": 123, "title": "示例 Kernel"},
                            "totalVersionCount": 1,
                        }
                    if method.endswith("ListKernelVersions"):
                        return {
                            "items": [{
                                "version": {
                                    "versionNumber": 1,
                                    "versionName": "v1",
                                    "id": 789,
                                },
                                "run": {
                                    "id": 456,
                                    "status": "complete",
                                    "dateCreated": "2026-01-01",
                                },
                            }]
                        }
                    raise AssertionError(method)

                def post_text(self, method: str, body: dict) -> str:
                    return json.dumps({"cells": [], "metadata": {}})

                def get_bytes(self, url: str) -> bytes:
                    import io
                    import zipfile
                    buffer = io.BytesIO()
                    with zipfile.ZipFile(buffer, "w") as archive:
                        archive.writestr("result.csv", "id,value\n1,2\n")
                    return buffer.getvalue()

                def close(self) -> None:
                    pass

            from unittest.mock import patch
            client.get_kernel_runtime_metadata = (  # type: ignore[method-assign]
                lambda kernel_ref, version_number: {
                    "enableGpu": True,
                    "enableInternet": False,
                    "machineShape": "Gpu",
                    "runtimeMetadataSource": "kaggle_sdk_version",
                    "runtimeMetadataVersion": version_number,
                }
            )
            with patch(
                "harvester.kaggle_client.KaggleWebServiceClient",
                FakeWebService,
            ):
                client._token = "test-token"
                result = client.archive_kernel(
                    "owner/kernel",
                    temp_dir,
                    version=1,
                    include_outputs=True,
                )

            self.assertTrue(Path(temp_dir, "kernel.ipynb").exists())
            self.assertTrue(Path(temp_dir, "kernel-metadata.json").exists())
            self.assertTrue(Path(temp_dir, "outputs", "result.csv").exists())
            self.assertEqual(result["selected_version"], 1)
            metadata = json.loads(
                Path(temp_dir, "kernel-metadata.json").read_text(encoding="utf-8")
            )
            self.assertTrue(metadata["enableGpu"])
            self.assertFalse(metadata["enableInternet"])
            self.assertEqual(metadata["machineShape"], "Gpu")


class ArchiverTests(unittest.TestCase):
    def test_archive_is_atomic_indexed_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = FakeKaggleClient()
            archiver = Archiver(
                client,  # type: ignore[arg-type]
                ArchiverConfig(harvest_root=temp_dir),
            )

            result = archiver.archive_kernel(
                "owner/kernel", score_direction="minimize", include_outputs=True
            )
            self.assertEqual(result.selected_version, 2)
            self.assertFalse(result.already_existed)
            self.assertTrue(Path(result.source_path).exists())

            entries = archiver.list_archives()
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0].file_count, 4)
            self.assertGreater(entries[0].size_bytes, 0)
            self.assertEqual(entries[0].competition, "example-competition")

            detail = archiver.get_archive_metadata(entries[0].id)
            self.assertTrue(detail["metadata"]["enableGpu"])
            self.assertFalse(detail["metadata"]["enableInternet"])
            self.assertEqual(detail["metadata"]["machineShape"], "Gpu")
            self.assertEqual(client.runtime_metadata_calls, 1)

            cached_detail = archiver.get_archive_metadata(entries[0].id)
            self.assertFalse(cached_detail["metadata"]["enableInternet"])
            self.assertEqual(client.runtime_metadata_calls, 1)

            duplicate = archiver.archive_kernel(
                "owner/kernel", score_direction="minimize"
            )
            self.assertTrue(duplicate.already_existed)
            self.assertEqual(client.calls, 1)

            files = archiver.list_archive_files(entries[0].id)
            self.assertIn("sample.ipynb", {item["name"] for item in files})
            self.assertTrue(archiver.delete_archive(entries[0].id))
            self.assertEqual(archiver.list_archives(), [])

    def test_unscored_kernel_falls_back_to_latest_version(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = FakeKaggleClient(scored=False)
            archiver = Archiver(
                client,  # type: ignore[arg-type]
                ArchiverConfig(harvest_root=temp_dir),
            )
            result = archiver.archive_kernel("owner/kernel")
            self.assertEqual(result.selected_version, 2)

    def test_rejects_invalid_kernel_ref(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            archiver = Archiver(
                FakeKaggleClient(),  # type: ignore[arg-type]
                ArchiverConfig(harvest_root=temp_dir),
            )
            with self.assertRaises(ValueError):
                archiver.archive_kernel("../owner/kernel")


class AutoArchiveTests(unittest.IsolatedAsyncioTestCase):
    async def test_strict_threshold_persistence_and_idempotence(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = FakeAutoArchiveKaggleClient()
            archiver = Archiver(
                client,  # type: ignore[arg-type]
                ArchiverConfig(harvest_root=temp_dir),
            )
            manager = AutoArchiveManager(
                client,  # type: ignore[arg-type]
                archiver,
                harvest_root=temp_dir,
                default_competition="example-competition",
            )
            await manager.update_config(
                AutoArchiveConfig(
                    enabled=False,
                    competition="example-competition",
                    score_threshold=7.0,
                    interval_minutes=1,
                    include_outputs=True,
                )
            )

            first = await manager.run_now(trigger="manual")
            self.assertEqual(first.status.checked_count, 3)
            self.assertEqual(first.status.matched_count, 1)
            self.assertEqual(first.status.archived_count, 1)
            self.assertEqual(first.status.skipped_count, 0)
            self.assertEqual(first.status.recent_results[0].ref, "owner/kernel")
            self.assertEqual(len(first.logs), 1)
            self.assertEqual(first.logs[0].trigger, "manual")
            self.assertEqual(first.logs[0].outcome, "success")
            self.assertEqual(first.logs[0].checked_count, 3)
            self.assertTrue(first.logs[0].details_available)
            first_detail = manager.get_run_detail(first.logs[0].id)
            self.assertIsNotNone(first_detail)
            assert first_detail is not None
            self.assertEqual(len(first_detail.items), 3)
            actions = {item.ref: item.action for item in first_detail.items}
            self.assertEqual(actions["owner/kernel"], "archived")
            self.assertEqual(actions["owner/equal"], "not_matched")
            self.assertEqual(archiver.list_archives()[0].public_score, 6.9)
            version_calls_after_first = client.version_calls

            restored = AutoArchiveManager(
                client,  # type: ignore[arg-type]
                archiver,
                harvest_root=temp_dir,
                default_competition="other-competition",
            )
            self.assertEqual(restored.snapshot().config.interval_minutes, 1)
            self.assertEqual(restored.snapshot().status.matched_count, 1)
            self.assertEqual(len(restored.snapshot().logs), 1)
            restored_detail = restored.get_run_detail(first.logs[0].id)
            self.assertIsNotNone(restored_detail)
            assert restored_detail is not None
            self.assertEqual(len(restored_detail.items), 3)

            second = await restored.run_now(trigger="scheduled")
            self.assertEqual(second.status.archived_count, 0)
            self.assertEqual(second.status.skipped_count, 1)
            self.assertEqual(client.calls, 1)
            self.assertEqual(client.version_calls, version_calls_after_first)
            self.assertEqual(len(second.logs), 2)
            self.assertEqual(second.logs[0].trigger, "scheduled")
            self.assertEqual(second.logs[0].skipped_count, 1)
            second_detail = restored.get_run_detail(second.logs[0].id)
            self.assertIsNotNone(second_detail)
            assert second_detail is not None
            self.assertEqual(len(second_detail.items), 3)

    async def test_higher_is_better_threshold_and_version_selection(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = FakeAutoArchiveKaggleClient(is_lower_better=False)
            archiver = Archiver(
                client,  # type: ignore[arg-type]
                ArchiverConfig(harvest_root=temp_dir),
            )
            manager = AutoArchiveManager(
                client,  # type: ignore[arg-type]
                archiver,
                harvest_root=temp_dir,
                default_competition="example-competition",
            )
            await manager.update_config(
                AutoArchiveConfig(
                    enabled=False,
                    competition="example-competition",
                    score_threshold=7.0,
                    interval_minutes=1,
                    include_outputs=True,
                )
            )

            result = await manager.run_now(trigger="manual")
            self.assertEqual(result.status.matched_count, 1)
            self.assertEqual(result.status.effective_score_direction, "maximize")
            self.assertEqual(result.status.recent_results[0].ref, "owner/high")
            self.assertEqual(result.status.recent_results[0].version_number, 1)
            self.assertEqual(client.list_kwargs["sort_by"], "scoreDescending")


class NotificationTests(unittest.IsolatedAsyncioTestCase):
    def test_notification_time_is_formatted_as_beijing_time(self) -> None:
        self.assertEqual(
            _format_beijing_time("2026-01-01T00:00:01Z"),
            "2026-01-01 08:00:01（北京时间）",
        )

        self.assertEqual(
            _format_beijing_time("2026-01-01T08:00:01+08:00"),
            "2026-01-01 08:00:01（北京时间）",
        )

    async def test_test_notification_includes_beijing_completion_time(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            manager = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            events: list[dict] = []
            manager._send_channel = (  # type: ignore[method-assign]
                lambda channel, event: events.append(event)
            )
            await manager.update_config(NotificationConfigUpdate(
                webhook_enabled=True,
                webhook_url="https://example.com/hook",
            ))

            result = await manager.send_test()

            self.assertTrue(result.success)
            self.assertEqual(len(events), 1)
            self.assertIn("完成时间：", events[0]["text"])
            self.assertIn("北京时间", events[0]["text"])

    async def test_archive_event_is_queued_delivered_and_deduplicated(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            manager = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            sent: list[tuple[str, str]] = []
            manager._send_channel = (  # type: ignore[method-assign]
                lambda channel, event: sent.append((channel, event["id"]))
            )
            await manager.start()
            try:
                await manager.update_config(NotificationConfigUpdate(
                    webhook_enabled=True,
                    webhook_url="https://example.com/hook",
                    notify_on_archive=True,
                    notify_on_failure=True,
                ))
                log = AutoArchiveRunLog(
                    id="a" * 32,
                    trigger="scheduled",
                    outcome="success",
                    started_at="2026-01-01T00:00:00Z",
                    finished_at="2026-01-01T00:00:01Z",
                    duration_seconds=1,
                    checked_count=50,
                    matched_count=1,
                    archived_count=1,
                )
                items = [AutoArchiveCheckedItem(
                    ref="owner/kernel",
                    title="Kernel",
                    author="owner",
                    public_score=6.9,
                    matched=True,
                    action="archived",
                    version_number=2,
                )]
                self.assertTrue(manager.enqueue_run(log, items, "example"))
                self.assertFalse(manager.enqueue_run(log, items, "example"))
                await manager.wait_until_idle()

                self.assertEqual(sent, [("webhook", log.id)])
                snapshot = manager.snapshot()
                self.assertEqual(snapshot.status.pending_count, 0)
                self.assertEqual(snapshot.status.last_event_id, log.id)
                self.assertFalse(manager.enqueue_run(log, items, "example"))
            finally:
                await manager.stop()

    async def test_quiet_success_run_does_not_notify(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            manager = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            await manager.update_config(NotificationConfigUpdate(
                webhook_enabled=True,
                webhook_url="https://example.com/hook",
            ))
            log = AutoArchiveRunLog(
                id="b" * 32,
                trigger="scheduled",
                outcome="success",
                started_at="2026-01-01T00:00:00Z",
                finished_at="2026-01-01T00:00:01Z",
                duration_seconds=1,
                checked_count=50,
            )
            self.assertFalse(manager.enqueue_run(log, [], "example"))
            self.assertEqual(manager.snapshot().status.pending_count, 0)

    async def test_partial_update_does_not_reset_notification_switches(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            manager = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            await manager.update_config(NotificationConfigUpdate(
                webhook_enabled=True,
                webhook_url="https://example.com/hook",
                notify_on_archive=True,
                notify_on_failure=True,
                webhook_format="feishu",
            ))

            # 模拟前端只提交部分字段（例如改阈值时通知表单缺字段）
            snapshot = await manager.update_config(NotificationConfigUpdate())
            self.assertTrue(snapshot.config.webhook_enabled)
            self.assertEqual(snapshot.config.webhook_format, "feishu")
            self.assertTrue(snapshot.config.notify_on_archive)

            # 显式关闭仍然生效
            disabled = await manager.update_config(NotificationConfigUpdate(
                webhook_enabled=False,
            ))
            self.assertFalse(disabled.config.webhook_enabled)
            self.assertEqual(disabled.config.webhook_format, "feishu")

    async def test_secrets_are_not_returned_or_saved_in_plain_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            manager = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            snapshot = await manager.update_config(NotificationConfigUpdate(
                webhook_enabled=True,
                webhook_url="https://example.com/secret-token",
                email_enabled=True,
                smtp_host="smtp.example.com",
                smtp_username="sender@example.com",
                smtp_password="secret-password",
                smtp_from="sender@example.com",
                smtp_to=["receiver@example.com"],
            ))

            self.assertTrue(snapshot.config.webhook_configured)
            self.assertTrue(snapshot.config.smtp_password_configured)
            serialized = (Path(temp_dir) / "_cache" / "notifications.json").read_text(
                encoding="utf-8"
            )
            self.assertNotIn("secret-token", serialized)
            self.assertNotIn("secret-password", serialized)


if __name__ == "__main__":
    unittest.main()
