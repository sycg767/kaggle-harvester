from __future__ import annotations

import asyncio
import json
import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harvester.models import (
    SimulationAgentStats, SimulationEpisode, SimulationHistoryPoint,
    SimulationMonitorConfig, SimulationMonitorStatus,
    SubmissionMonitorStatus, SubmissionMonitorItem,
)
from harvester.simulation_monitor import SimulationMonitorManager
from harvester.submission_monitor import SubmissionMonitorManager
from main import ApiKeyMiddleware
from routers.health import router


class UncopyableLog:
    def model_copy(self, **kwargs):
        raise AssertionError("Health must not copy run logs")


def manager_without_io(cls, status):
    manager = object.__new__(cls)
    manager._state_lock = threading.RLock()
    manager._run_lock = asyncio.Lock()
    manager._task = None
    manager._status = status
    manager._logs = [UncopyableLog()]
    return manager


class HealthProjectionTests(unittest.TestCase):
    def test_simulation_history_does_not_expand_response_or_trigger_probe(self):
        agent = SimulationAgentStats(submission_id=123, score=42, wins=8)
        status = SimulationMonitorStatus(agents=[agent], total_tracked_episodes=100)
        manager = manager_without_io(SimulationMonitorManager, status)
        manager._config = SimulationMonitorConfig(enabled=True)
        with patch.object(manager, "_get_clawbot_status", side_effect=AssertionError("network probe")):
            initial = manager.health_status()
            episode = SimulationEpisode(id=1, my_submission_id=123)
            history = SimulationHistoryPoint(timestamp="2026-10-01T00:00:00Z", submission_id=123)
            agent.recent_episodes = [episode] * 10000
            status.history = [history] * 10000
            status.history_points = [history] * 10000
            manager._history_points = status.history_points
            result = manager.health_status()
        self.assertEqual(json.dumps(initial), json.dumps(result))
        self.assertEqual(result["agents"][0]["score"], 42)
        self.assertEqual(result["agents"][0]["wins"], 8)
        self.assertTrue(result["enabled"])
        self.assertEqual(len(agent.recent_episodes), 10000)
        self.assertLess(len(json.dumps(result)), 4000)

    def test_submission_health_omits_details_and_retains_counts(self):
        status = SubmissionMonitorStatus(scored_count=9)
        manager = manager_without_io(SubmissionMonitorManager, status)
        item = SubmissionMonitorItem(ref="123", public_score=42)
        status.recent_items = [item]
        initial = manager.health_status()
        status.recent_items = [item] * 10000
        self.assertEqual(initial, manager.health_status())
        self.assertEqual(initial["scored_count"], 9)
        self.assertEqual(len(initial["recent_items"]), 1)
        self.assertEqual(initial["recent_items"][0]["public_score"], 42)


class HealthRouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.add_middleware(ApiKeyMiddleware, api_key="test-key")
        state = self.app.state
        state.kaggle_client = SimpleNamespace(readiness=lambda: {
            "kaggle_cli": True, "utf8_wrapper_exists": True,
        })
        state.archiver = SimpleNamespace(get_stats=lambda: {})
        for name in ("kernel_query_cache", "kernel_score_cache", "kernel_metadata_cache",
                     "competition_cache", "entered_competitions_cache"):
            setattr(state, name, SimpleNamespace(stats=lambda: {}))
        state.active_competition_store = SimpleNamespace(get=lambda: "example")
        for name in ("auto_archive", "submission_monitor", "simulation_monitor", "notifications"):
            setattr(state, name, SimpleNamespace(
                health_status=lambda: {}, snapshot=Mock(side_effect=AssertionError("full snapshot")),
            ))

    async def test_live_requires_auth_and_no_manager_state(self):
        app = FastAPI()
        app.include_router(router)
        app.add_middleware(ApiKeyMiddleware, api_key="test-key")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            self.assertEqual((await client.get("/api/live")).status_code, 401)
            response = await client.get("/api/live", headers={"X-Harvester-Key": "test-key"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    async def test_slow_health_does_not_block_live_or_event_loop(self):
        started = threading.Event()
        release = threading.Event()

        def slow_readiness():
            started.set()
            if not release.wait(timeout=3):
                raise AssertionError("Event loop blocked by health readiness")
            return {"kaggle_cli": True, "utf8_wrapper_exists": True}

        self.app.state.kaggle_client.readiness = slow_readiness
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test",
            headers={"X-Harvester-Key": "test-key"},
        ) as client:
            with patch("routers.health.resolve_active_competition", return_value=("example", "pinned")):
                health_task = asyncio.create_task(client.get("/api/health"))
                try:
                    did_start = await asyncio.to_thread(started.wait, 2)
                    self.assertTrue(did_start)
                    response = await asyncio.wait_for(client.get("/api/live"), timeout=1)
                    self.assertEqual(response.status_code, 200)
                    self.assertFalse(health_task.done())
                finally:
                    release.set()
                    health_response = await health_task
                self.assertEqual(health_response.status_code, 200)
                self.assertEqual(health_response.headers["Cache-Control"], "no-store")
                self.assertEqual(health_response.json()["status"], "ok")


if __name__ == "__main__":
    unittest.main()
