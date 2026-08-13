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
from harvester.cache import PersistentEnteredCompetitionsCache
from harvester.kaggle_client import (
    _competition_slug_from_ref,
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
    CompetitionSubmission,
    EnteredCompetition,
    KernelSummary,
    NotificationConfigUpdate,
    ScoredKernel,
    SubmissionMonitorConfig,
    SubmissionMonitorRunLog,
    VersionInfo,
    VersionScoreList,
)
from harvester.notifications import NotificationManager
from harvester.notifications import _format_beijing_time
from harvester.submission_monitor import SubmissionMonitorManager


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
    def __init__(self, is_lower_better: bool = True, direction_source: str = "leaderboard") -> None:
        super().__init__()
        self.is_lower_better = is_lower_better
        self.direction_source = direction_source

    def fetch_competition_info(
        self, competition: str, refresh: bool = False
    ) -> CompetitionInfo:
        return CompetitionInfo(
            id=competition,
            title=competition,
            category="featured",
            is_lower_better=self.is_lower_better,
            score_direction_source=self.direction_source,
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


class EnteredCompetitionParsingTests(unittest.TestCase):
    def test_competition_slug_from_url_or_plain_ref(self) -> None:
        self.assertEqual(
            _competition_slug_from_ref(
                "https://www.kaggle.com/competitions/rogii-wellbore-geology-prediction"
            ),
            "rogii-wellbore-geology-prediction",
        )
        self.assertEqual(
            _competition_slug_from_ref("rogii-wellbore-geology-prediction"),
            "rogii-wellbore-geology-prediction",
        )
        self.assertEqual(
            _competition_slug_from_ref(
                "https://www.kaggle.com/competitions/pokemon-tcg-ai-battle?foo=1"
            ),
            "pokemon-tcg-ai-battle",
        )

    def test_list_entered_competitions_accepts_url_refs(self) -> None:
        client = KaggleClient()
        client._run_kaggle_json = (  # type: ignore[method-assign]
            lambda args, timeout=90: [
                {
                    "ref": "https://www.kaggle.com/competitions/rogii-wellbore-geology-prediction",
                    "title": "ROGII",
                    "category": "Featured",
                    "deadline": "2026-08-05T23:59:00",
                    "reward": "50,000 Usd",
                    "teamCount": 10,
                    "userHasEntered": True,
                },
                {
                    "ref": "plain-slug-comp",
                    "category": "Featured",
                    "teamCount": 1,
                },
            ]
        )
        items = client.list_entered_competitions()
        self.assertEqual(
            [item.id for item in items],
            ["rogii-wellbore-geology-prediction", "plain-slug-comp"],
        )
        self.assertEqual(items[0].title, "ROGII")
        self.assertEqual(items[1].title, "plain-slug-comp")

    def test_entered_competitions_cache_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = PersistentEnteredCompetitionsCache(temp_dir)
            self.assertIsNone(cache.get())
            payload = [
                EnteredCompetition(
                    id="rogii-wellbore-geology-prediction",
                    title="ROGII",
                    category="Featured",
                )
            ]
            cache.set(payload)
            restored = cache.get()
            self.assertIsNotNone(restored)
            assert restored is not None
            self.assertEqual(restored[0].id, "rogii-wellbore-geology-prediction")
            self.assertEqual(cache.stats()["entered_competitions_cached"], 1)


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
    def test_low_disk_space_blocks_download(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = FakeKaggleClient()
            archiver = Archiver(
                client,  # type: ignore[arg-type]
                ArchiverConfig(harvest_root=temp_dir, min_free_bytes=10 ** 20),
            )
            with self.assertRaisesRegex(OSError, "磁盘剩余空间不足"):
                archiver.archive_kernel("owner/kernel", score_direction="minimize")
            self.assertEqual(client.calls, 0)
            stats = archiver.get_stats()
            self.assertTrue(stats["low_disk_space"])
            self.assertGreater(stats["disk_total_bytes"], 0)

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
    async def test_unknown_score_direction_blocks_auto_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = FakeAutoArchiveKaggleClient(direction_source="fallback")
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
            await manager.update_config(AutoArchiveConfig(
                competitions=["example-competition"],
                score_thresholds={"example-competition": 7.0},
                score_direction="auto",
            ))
            snapshot = await manager.run_now()
            self.assertIn("分数方向无法可靠识别", snapshot.status.last_error or "")
            self.assertEqual(snapshot.status.checked_count, 0)
            self.assertEqual(client.calls, 0)

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
                    competitions=["example-competition"],
                    score_thresholds={"example-competition": 7.0},
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
            self.assertEqual(first.status.competitions_checked, ["example-competition"])
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
            self.assertEqual(
                restored.snapshot().config.competitions, ["example-competition"]
            )
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

    async def test_legacy_single_competition_config_migrates(self) -> None:
        config = AutoArchiveConfig(
            enabled=False,
            competition="legacy-comp",
            score_threshold=6.5,
            interval_minutes=10,
        )
        self.assertEqual(config.competitions, ["legacy-comp"])
        self.assertEqual(config.score_thresholds, {"legacy-comp": 6.5})
        self.assertEqual(config.threshold_for("legacy-comp"), 6.5)

        monitor_config = SubmissionMonitorConfig(
            enabled=False,
            competition="legacy-comp",
            interval_minutes=5,
        )
        self.assertEqual(monitor_config.competitions, ["legacy-comp"])

    async def test_multi_competition_thresholds_apply_independently(self) -> None:
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
                default_competition="comp-a",
            )
            await manager.update_config(
                AutoArchiveConfig(
                    enabled=False,
                    competitions=["comp-a", "comp-b"],
                    score_thresholds={"comp-a": 7.0, "comp-b": 6.0},
                    interval_minutes=1,
                    include_outputs=True,
                )
            )
            result = await manager.run_now(trigger="manual")
            self.assertEqual(result.status.competitions_checked, ["comp-a", "comp-b"])
            # 每个竞赛 3 个 kernel，阈值 7.0 命中 1 个，阈值 6.0 不命中
            self.assertEqual(result.status.checked_count, 6)
            self.assertEqual(result.status.matched_count, 1)
            self.assertEqual(result.status.archived_count, 1)
            self.assertEqual(result.status.recent_results[0].competition, "comp-a")
            self.assertEqual(result.status.recent_results[0].ref, "owner/kernel")

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
                    competitions=["example-competition"],
                    score_thresholds={"example-competition": 7.0},
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

    async def test_submission_score_event_is_deduplicated_and_respects_switch(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            manager = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            sent: list[str] = []
            manager._send_channel = (  # type: ignore[method-assign]
                lambda channel, event: sent.append(event["id"])
            )
            await manager.start()
            try:
                await manager.update_config(NotificationConfigUpdate(
                    webhook_enabled=True,
                    webhook_url="https://example.com/hook",
                    notify_on_score=True,
                ))
                payload = [{
                    "ref": "54939125",
                    "description": "dexp001",
                    "public_score": 6.368,
                    "public_score_display": "6.368",
                    "status": "Finished",
                }]
                self.assertEqual(
                    manager.enqueue_submission_scores(
                        competition="example-comp",
                        events=payload,
                    ),
                    1,
                )
                self.assertEqual(
                    manager.enqueue_submission_scores(
                        competition="example-comp",
                        events=payload,
                    ),
                    0,
                )
                await manager.wait_until_idle()
                self.assertEqual(sent, ["score::example-comp::54939125"])

                await manager.update_config(NotificationConfigUpdate(
                    notify_on_score=False,
                ))
                self.assertEqual(
                    manager.enqueue_submission_scores(
                        competition="example-comp",
                        events=[{
                            "ref": "54939126",
                            "description": "dexp002",
                            "public_score": 6.2,
                            "public_score_display": "6.2",
                        }],
                    ),
                    0,
                )
            finally:
                await manager.stop()

    async def test_partial_update_preserves_notify_on_score(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            manager = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            await manager.update_config(NotificationConfigUpdate(
                webhook_enabled=True,
                webhook_url="https://example.com/hook",
                notify_on_score=False,
            ))
            snapshot = await manager.update_config(NotificationConfigUpdate(
                webhook_format="feishu",
            ))
            self.assertFalse(snapshot.config.notify_on_score)
            self.assertEqual(snapshot.config.webhook_format, "feishu")

    def test_detect_webhook_format_from_url(self) -> None:
        self.assertEqual(
            NotificationManager.detect_webhook_format(
                "https://open.feishu.cn/open-apis/bot/v2/hook/abc"
            ),
            "feishu",
        )
        self.assertEqual(
            NotificationManager.detect_webhook_format(
                "https://oapi.dingtalk.com/robot/send?access_token=x"
            ),
            "dingtalk",
        )
        self.assertEqual(
            NotificationManager.detect_webhook_format(
                "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x"
            ),
            "wecom",
        )
        self.assertEqual(
            NotificationManager.detect_webhook_format(
                "https://hooks.slack.com/services/T/B/X"
            ),
            "slack",
        )
        self.assertEqual(
            NotificationManager.detect_webhook_format("https://ntfy.sh/topic"),
            "ntfy",
        )
        self.assertIsNone(
            NotificationManager.detect_webhook_format("https://example.com/hook")
        )

    async def test_feishu_url_upgrades_generic_format(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            manager = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            snapshot = await manager.update_config(NotificationConfigUpdate(
                webhook_enabled=True,
                webhook_url="https://open.feishu.cn/open-apis/bot/v2/hook/token",
                webhook_format="generic",
            ))
            self.assertEqual(snapshot.config.webhook_format, "feishu")

            # 显式选择钉钉时即使 URL 是飞书也不覆盖（用户意图优先）
            kept = await manager.update_config(NotificationConfigUpdate(
                webhook_format="dingtalk",
            ))
            self.assertEqual(kept.config.webhook_format, "dingtalk")

    async def test_load_state_migrates_generic_feishu_url(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            secrets.update({
                "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/x",
            })
            cache = Path(temp_dir) / "_cache"
            cache.mkdir(parents=True, exist_ok=True)
            (cache / "notifications.json").write_text(
                json.dumps({
                    "version": 2,
                    "config": {
                        "notify_on_archive": True,
                        "notify_on_failure": True,
                        "notify_on_score": True,
                        "webhook_enabled": True,
                        "webhook_format": "generic",
                        "email_enabled": False,
                        "smtp_host": "",
                        "smtp_port": 587,
                        "smtp_security": "starttls",
                        "smtp_username": "",
                        "smtp_from": "",
                        "smtp_to": [],
                    },
                    "status": {},
                    "pending": {},
                    "delivered": {},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            manager = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            self.assertEqual(manager.snapshot().config.webhook_format, "feishu")
            saved = json.loads(
                (cache / "notifications.json").read_text(encoding="utf-8")
            )
            self.assertEqual(saved["config"]["webhook_format"], "feishu")


class FakeSubmissionClient:
    def __init__(
        self,
        batches: list[list[CompetitionSubmission]] | None = None,
        by_competition: dict[str, list[list[CompetitionSubmission]]] | None = None,
    ) -> None:
        self._batches = list(batches or [])
        self._by_competition = {
            key: [list(batch) for batch in value]
            for key, value in (by_competition or {}).items()
        }
        self.calls = 0
        self.competitions: list[str] = []

    def list_competition_submissions(
        self,
        competition: str = "",
        page_size: int = 10,
    ) -> list[CompetitionSubmission]:
        self.calls += 1
        self.competitions.append(competition)
        if competition in self._by_competition:
            queue = self._by_competition[competition]
            if not queue:
                return []
            return queue.pop(0)
        if not self._batches:
            return []
        return self._batches.pop(0)


class SubmissionMonitorTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_submission_is_not_counted_as_pending_and_keeps_submitter(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = FakeSubmissionClient([
                [
                    CompetitionSubmission(
                        ref="failed-1",
                        description="bad-file",
                        status="ERROR",
                        error_description="Submission file has invalid columns.",
                        submitted_by="Alice",
                        submitted_by_ref="alice-kaggle",
                        team_name="Example Team",
                        public_score=None,
                    ),
                    CompetitionSubmission(
                        ref="pending-1",
                        description="still-running",
                        status="PENDING",
                        public_score=None,
                    ),
                ],
            ])
            monitor = SubmissionMonitorManager(  # type: ignore[arg-type]
                client,
                temp_dir,
                "example-comp",
            )
            await monitor.update_config(SubmissionMonitorConfig(
                enabled=False,
                competitions=["example-comp"],
            ))

            snapshot = await monitor.run_now(trigger="manual")
            self.assertEqual(snapshot.status.failed_count, 1)
            self.assertEqual(snapshot.status.pending_count, 1)
            self.assertEqual(snapshot.status.scored_count, 0)
            detail = monitor.get_run_detail(snapshot.logs[0].id)
            self.assertIsNotNone(detail)
            assert detail is not None
            failed = next(item for item in detail.items if item.ref == "failed-1")
            self.assertEqual(failed.state, "failed")
            self.assertEqual(failed.submitted_by, "Alice")
            self.assertEqual(failed.error_description, "Submission file has invalid columns.")

    async def test_run_detail_file_flag_is_true_after_save(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = FakeSubmissionClient([
                [
                    CompetitionSubmission(
                        ref="200",
                        description="pending-only",
                        status="Pending",
                        public_score=None,
                    ),
                ],
            ])
            monitor = SubmissionMonitorManager(  # type: ignore[arg-type]
                client,
                temp_dir,
                "example-comp",
            )
            await monitor.update_config(SubmissionMonitorConfig(
                enabled=False,
                competitions=["example-comp"],
                interval_minutes=5,
                page_size=10,
            ))
            snapshot = await monitor.run_now(trigger="manual")
            log = snapshot.logs[0]
            self.assertTrue(log.details_available)
            path = Path(temp_dir) / "_cache" / "submission_monitor_runs" / f"{log.id}.json"
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertTrue(saved["log"]["details_available"])
            self.assertEqual(len(saved["items"]), 1)
            detail = monitor.get_run_detail(log.id)
            self.assertIsNotNone(detail)
            assert detail is not None
            self.assertTrue(detail.log.details_available)
            self.assertEqual(len(detail.items), 1)

    async def test_get_run_detail_recovers_stale_false_flag_in_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = FakeSubmissionClient([[]])
            monitor = SubmissionMonitorManager(  # type: ignore[arg-type]
                client,
                temp_dir,
                "example-comp",
            )
            log = SubmissionMonitorRunLog(
                id="a" * 32,
                trigger="manual",
                outcome="success",
                started_at="2026-01-01T00:00:00+00:00",
                finished_at="2026-01-01T00:00:01+00:00",
                duration_seconds=1.0,
                checked_count=1,
                pending_count=1,
                scored_count=0,
                newly_scored_count=0,
                details_available=True,
            )
            monitor._logs = [log]
            runs = Path(temp_dir) / "_cache" / "submission_monitor_runs"
            runs.mkdir(parents=True, exist_ok=True)
            # 模拟旧 bug：明细文件里 details_available 仍为 False，但 items 已写入。
            (runs / f"{log.id}.json").write_text(
                json.dumps({
                    "log": {
                        **log.model_dump(),
                        "details_available": False,
                    },
                    "items": [{
                        "ref": "54970637",
                        "description": "dexp",
                        "status": "PENDING",
                        "public_score": None,
                        "watched": True,
                        "newly_scored": False,
                    }],
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            detail = monitor.get_run_detail(log.id)
            self.assertIsNotNone(detail)
            assert detail is not None
            self.assertTrue(detail.log.details_available)
            self.assertEqual(len(detail.items), 1)
            self.assertEqual(detail.items[0].ref, "54970637")

    async def test_baseline_seed_then_none_to_score_notifies_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            notifications = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            sent: list[str] = []
            notifications._send_channel = (  # type: ignore[method-assign]
                lambda channel, event: sent.append(event["id"])
            )
            await notifications.start()
            try:
                await notifications.update_config(NotificationConfigUpdate(
                    webhook_enabled=True,
                    webhook_url="https://example.com/hook",
                    notify_on_score=True,
                ))
                client = FakeSubmissionClient([
                    [
                        CompetitionSubmission(
                            ref="100",
                            description="dexp001",
                            status="Pending",
                            public_score=None,
                        ),
                        CompetitionSubmission(
                            ref="101",
                            description="old-scored",
                            status="Finished",
                            public_score=6.9,
                            public_score_display="6.9",
                        ),
                    ],
                    [
                        CompetitionSubmission(
                            ref="100",
                            description="dexp001",
                            status="Finished",
                            public_score=6.368,
                            public_score_display="6.368",
                        ),
                        CompetitionSubmission(
                            ref="101",
                            description="old-scored",
                            status="Finished",
                            public_score=6.9,
                            public_score_display="6.9",
                        ),
                    ],
                    [
                        CompetitionSubmission(
                            ref="100",
                            description="dexp001",
                            status="Finished",
                            public_score=6.368,
                            public_score_display="6.368",
                        ),
                    ],
                ])
                monitor = SubmissionMonitorManager(  # type: ignore[arg-type]
                    client,
                    temp_dir,
                    "example-comp",
                    notification_manager=notifications,
                )
                await monitor.update_config(SubmissionMonitorConfig(
                    enabled=False,
                    competitions=["example-comp"],
                    interval_minutes=5,
                    page_size=10,
                ))

                baseline = await monitor.run_now(trigger="manual")
                self.assertEqual(baseline.status.newly_scored_count, 0)
                self.assertEqual(baseline.status.scored_count, 1)
                self.assertEqual(baseline.status.pending_count, 1)
                self.assertTrue(baseline.logs[0].details_available)
                detail = monitor.get_run_detail(baseline.logs[0].id)
                self.assertIsNotNone(detail)
                assert detail is not None
                self.assertEqual(len(detail.items), 2)
                await notifications.wait_until_idle()
                self.assertEqual(sent, [])

                first = await monitor.run_now(trigger="manual")
                self.assertEqual(first.status.newly_scored_count, 1)
                self.assertEqual(first.status.recent_events[0].ref, "100")
                first_detail = monitor.get_run_detail(first.logs[0].id)
                self.assertIsNotNone(first_detail)
                assert first_detail is not None
                newly = [item for item in first_detail.items if item.newly_scored]
                self.assertEqual([item.ref for item in newly], ["100"])
                self.assertIsNotNone(newly[0].scored_at)
                await notifications.wait_until_idle()
                self.assertEqual(sent, ["score::example-comp::100"])

                second = await monitor.run_now(trigger="manual")
                self.assertEqual(second.status.newly_scored_count, 0)
                await notifications.wait_until_idle()
                self.assertEqual(sent, ["score::example-comp::100"])
            finally:
                await notifications.stop()

    async def test_multi_competition_baselines_are_isolated(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            secrets = FakeSecretStore()
            notifications = NotificationManager(  # type: ignore[arg-type]
                temp_dir, secret_store=secrets
            )
            sent: list[str] = []
            notifications._send_channel = (  # type: ignore[method-assign]
                lambda channel, event: sent.append(event["id"])
            )
            await notifications.start()
            try:
                await notifications.update_config(NotificationConfigUpdate(
                    webhook_enabled=True,
                    webhook_url="https://example.com/hook",
                    notify_on_score=True,
                ))
                client = FakeSubmissionClient(
                    by_competition={
                        "comp-a": [
                            [
                                CompetitionSubmission(
                                    ref="shared-ref",
                                    description="a-pending",
                                    status="Pending",
                                    public_score=None,
                                ),
                            ],
                            [
                                CompetitionSubmission(
                                    ref="shared-ref",
                                    description="a-scored",
                                    status="Finished",
                                    public_score=1.0,
                                    public_score_display="1.0",
                                ),
                            ],
                        ],
                        "comp-b": [
                            [
                                CompetitionSubmission(
                                    ref="shared-ref",
                                    description="b-scored",
                                    status="Finished",
                                    public_score=2.0,
                                    public_score_display="2.0",
                                ),
                            ],
                            [
                                CompetitionSubmission(
                                    ref="shared-ref",
                                    description="b-scored",
                                    status="Finished",
                                    public_score=2.0,
                                    public_score_display="2.0",
                                ),
                            ],
                        ],
                    }
                )
                monitor = SubmissionMonitorManager(  # type: ignore[arg-type]
                    client,
                    temp_dir,
                    "comp-a",
                    notification_manager=notifications,
                )
                await monitor.update_config(SubmissionMonitorConfig(
                    enabled=False,
                    competitions=["comp-a", "comp-b"],
                    interval_minutes=5,
                    page_size=10,
                ))

                baseline = await monitor.run_now(trigger="manual")
                self.assertEqual(baseline.status.competitions_checked, ["comp-a", "comp-b"])
                self.assertEqual(baseline.status.newly_scored_count, 0)
                self.assertEqual(baseline.status.checked_count, 2)
                await notifications.wait_until_idle()
                self.assertEqual(sent, [])

                scored = await monitor.run_now(trigger="manual")
                self.assertEqual(scored.status.newly_scored_count, 1)
                self.assertEqual(scored.status.recent_events[0].competition, "comp-a")
                self.assertEqual(scored.status.recent_events[0].ref, "shared-ref")
                await notifications.wait_until_idle()
                self.assertEqual(sent, ["score::comp-a::shared-ref"])
                self.assertEqual(client.competitions, ["comp-a", "comp-b", "comp-a", "comp-b"])
            finally:
                await notifications.stop()

    async def test_description_prefix_filters_submissions(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            client = FakeSubmissionClient([
                [
                    CompetitionSubmission(
                        ref="1",
                        description="dexp001-run",
                        status="Finished",
                        public_score=None,
                    ),
                    CompetitionSubmission(
                        ref="2",
                        description="other",
                        status="Finished",
                        public_score=None,
                    ),
                ],
                [
                    CompetitionSubmission(
                        ref="1",
                        description="dexp001-run",
                        status="Finished",
                        public_score=1.0,
                        public_score_display="1.0",
                    ),
                    CompetitionSubmission(
                        ref="2",
                        description="other",
                        status="Finished",
                        public_score=2.0,
                        public_score_display="2.0",
                    ),
                ],
            ])
            monitor = SubmissionMonitorManager(  # type: ignore[arg-type]
                client,
                temp_dir,
                "example-comp",
            )
            await monitor.update_config(SubmissionMonitorConfig(
                enabled=False,
                competitions=["example-comp"],
                description_prefix="dexp",
            ))
            await monitor.run_now(trigger="manual")
            scored = await monitor.run_now(trigger="manual")
            self.assertEqual(scored.status.checked_count, 1)
            self.assertEqual(scored.status.newly_scored_count, 1)
            self.assertEqual(scored.status.recent_events[0].ref, "1")


if __name__ == "__main__":
    unittest.main()
