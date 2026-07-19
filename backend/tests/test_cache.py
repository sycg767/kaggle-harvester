from __future__ import annotations

import asyncio
import sys
import tempfile
import time
import unittest
from pathlib import Path

from fastapi import Response

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harvester.cache import (
    PersistentCompetitionCache,
    PersistentKernelMetadataCache,
    PersistentKernelQueryCache,
    PersistentKernelScoreCache,
)
from harvester.models import CompetitionInfo, ScoredKernel, VersionInfo
import main as api_main


class PersistentCacheTests(unittest.TestCase):
    def test_kernel_type_and_failed_check_survive_restart(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = PersistentKernelMetadataCache(temp_dir)
            cache.merge_checked({
                "owner/notebook": "Notebook",
                "owner/unavailable": None,
            })

            restored = PersistentKernelMetadataCache(temp_dir).get_many([
                "owner/notebook",
                "owner/unavailable",
            ])
            self.assertEqual(restored["owner/notebook"].kernel_type, "notebook")
            self.assertEqual(restored["owner/unavailable"].kernel_type, "")
            self.assertGreater(restored["owner/unavailable"].checked_at, 0)
            self.assertEqual(cache.stats()["known_kernel_types"], 1)

    def test_query_snapshot_survives_process_restart_without_expiry(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            params = {
                "competition": "example",
                "include_scores": True,
                "max_pages": 1,
                "page_size": 50,
                "score_limit": 50,
                "sort_by": "voteCount",
            }
            data = [
                ScoredKernel(
                    ref="owner/kernel",
                    title="Kernel",
                    author="owner",
                    public_score=7.1,
                )
            ]
            PersistentKernelQueryCache(temp_dir).set(params, data)

            hit = PersistentKernelQueryCache(temp_dir).get(params)
            self.assertIsNotNone(hit)
            self.assertEqual(hit.data[0].public_score, 7.1)  # type: ignore[union-attr]

    def test_current_score_changes_only_when_last_run_changes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = PersistentKernelScoreCache(temp_dir)
            cache.set_current("owner/kernel", "run-1", 7.1, "7.1000")

            self.assertEqual(
                cache.get_current("owner/kernel", "run-1").public_score,  # type: ignore[union-attr]
                7.1,
            )
            self.assertIsNone(cache.get_current("owner/kernel", "run-2"))

    def test_empty_current_score_expires_without_run_time_change(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = PersistentKernelScoreCache(temp_dir)
            cache.set_current("owner/kernel", "run-1", None, None)

            self.assertIsNotNone(cache.get_current("owner/kernel", "run-1"))
            cache.NEGATIVE_SCORE_TTL_SECONDS = 0
            self.assertIsNone(cache.get_current("owner/kernel", "run-1"))

    def test_completed_versions_are_append_only(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = PersistentKernelScoreCache(temp_dir)
            first = VersionInfo(
                version_number=1,
                title="v1",
                status="complete",
                date_created="2026-01-01",
                public_lb_numeric=7.1,
            )
            cache.merge_versions("owner/kernel", [first])

            changed_first = first.model_copy(update={"public_lb_numeric": 9.9})
            second = first.model_copy(
                update={"version_number": 2, "title": "v2", "public_lb_numeric": 6.9}
            )
            running = first.model_copy(
                update={"version_number": 3, "title": "v3", "status": "running"}
            )
            merged = cache.merge_versions(
                "owner/kernel", [changed_first, second, running]
            )
            scores = {item.version_number: item.public_lb_numeric for item in merged}
            self.assertEqual(scores[1], 7.1)
            self.assertEqual(scores[2], 6.9)
            self.assertIn(3, scores)

            persisted = PersistentKernelScoreCache(temp_dir).get_versions(
                "owner/kernel"
            )
            self.assertEqual(
                {item.version_number for item in persisted}, {1, 2}
            )

    def test_competition_snapshot_survives_restart(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            info = CompetitionInfo(
                id="example",
                title="Example Competition",
                category="featured",
                is_lower_better=True,
            )
            PersistentCompetitionCache(temp_dir).set("example", info)
            cached = PersistentCompetitionCache(temp_dir).get("example")
            self.assertEqual(cached, info)


class StaleWhileRevalidateTests(unittest.IsolatedAsyncioTestCase):
    async def test_stale_snapshot_returns_before_background_refresh_finishes(self) -> None:
        class SlowClient:
            competition_slug = "example"

            def list_kernels(self, **_kwargs):
                time.sleep(0.25)
                from harvester.models import KernelSummary
                return [KernelSummary(ref="owner/new", title="New", author="owner")]

            def enrich_kernel_summaries(self, summaries, **_kwargs):
                return [
                    ScoredKernel(ref=item.ref, title=item.title, author=item.author)
                    for item in summaries
                ]

            def enrich_kernel_metadata(self, _kernels):
                return False

        with tempfile.TemporaryDirectory() as temp_dir:
            cache = PersistentKernelQueryCache(temp_dir)
            params = {
                "competition": "example",
                "include_scores": True,
                "max_pages": 1,
                "page_size": 50,
                "score_limit": 50,
                "sort_by": "scoreAscending",
            }
            cache.set(params, [
                ScoredKernel(ref="owner/cached", title="Cached", author="owner")
            ])
            api_main.app.state.kaggle_client = SlowClient()
            api_main.app.state.kernel_query_cache = cache
            api_main.app.state.kernel_refresh_tasks = {}
            previous_refresh_seconds = api_main.SCORE_INDEX_REFRESH_SECONDS
            api_main.SCORE_INDEX_REFRESH_SECONDS = 0
            response = Response()
            try:
                started = time.perf_counter()
                result = await api_main.list_kernels(
                    response=response,
                    sort_by="scoreAscending",
                    page_size=50,
                    max_pages=1,
                    competition="example",
                    include_scores=True,
                    score_limit=50,
                    refresh=False,
                )
                elapsed = time.perf_counter() - started
                self.assertLess(elapsed, 0.15)
                self.assertEqual(result[0].ref, "owner/cached")
                self.assertEqual(response.headers["X-Kernel-Cache"], "STALE")
                self.assertEqual(response.headers["X-Kernel-Refresh"], "scheduled")

                await asyncio.gather(
                    *api_main.app.state.kernel_refresh_tasks.values()
                )
                refreshed = cache.get(params)
                self.assertIsNotNone(refreshed)
                self.assertEqual(refreshed.data[0].ref, "owner/new")  # type: ignore[union-attr]
            finally:
                api_main.SCORE_INDEX_REFRESH_SECONDS = previous_refresh_seconds
                for task in api_main.app.state.kernel_refresh_tasks.values():
                    task.cancel()


if __name__ == "__main__":
    unittest.main()
