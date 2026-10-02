from __future__ import annotations

import json
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from harvester.models import (
    SimulationAgentStats, SimulationMedalThresholds, SimulationMonitorConfig,
    SimulationMonitorRunLog, SimulationMonitorStatus,
)
from harvester.simulation_monitor import SimulationMonitorManager
from routers.simulation_monitor import router


class TestSimulationArena(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # No Kaggle methods: reading either view must stay completely offline.
        self.manager = SimulationMonitorManager(SimpleNamespace(), self.temp.name, "current-contest")
        self.manager._config = SimulationMonitorConfig(competition="current-contest", enabled=True)
        self.manager._status = SimulationMonitorStatus(
            competition="current-contest", agents=[SimulationAgentStats(submission_id=200, score=2700)],
            last_checked_at="2026-10-02T00:00:00Z",
        )

    def save_run(self, competition="ended-contest", stamp="2026-09-18T07:59:40Z", score=800):
        log = SimulationMonitorRunLog(
            id=uuid.uuid4().hex, trigger="scheduled", outcome="success",
            started_at=stamp, finished_at=stamp, duration_seconds=1,
            competition=competition, agent_count=1, total_episodes_found=20, details_available=True,
        )
        self.manager._save_run_detail(
            log, [SimulationAgentStats(submission_id=100, score=score, total_episodes=20)],
            SimulationMedalThresholds(total_teams=939, bronze_cutoff_score=700),
        )
        return log

    def test_old_competition_outside_recent_log_window_survives_restart(self):
        self.save_run()
        self.manager._logs = []
        self.manager._save_state()
        before = self.manager._state_path.read_bytes()
        restarted = SimulationMonitorManager(SimpleNamespace(), self.temp.name)
        view = restarted.arena_snapshot("ended-contest")
        self.assertEqual(view.source, "history")
        self.assertEqual(view.status.competition, "ended-contest")
        self.assertEqual(view.status.agents[0].score, 800)
        self.assertEqual(view.status.thresholds.bronze_cutoff_score, 700)
        self.assertEqual(view.captured_at, "2026-09-18T07:59:40Z")
        self.assertFalse(view.status.enabled)
        self.assertFalse(view.status.scheduler_alive)
        self.assertEqual(restarted._config.competition, "current-contest")
        self.assertTrue(restarted._config.enabled)
        self.assertEqual(restarted._status.agents[0].submission_id, 200)
        self.assertEqual(restarted._state_path.read_bytes(), before)
        self.assertEqual(restarted.arena_snapshot().source, "current")

    def test_empty_competition_never_borrows_active_agents(self):
        view = self.manager.arena_snapshot("never-collected")
        self.assertEqual(view.source, "empty")
        self.assertEqual(view.status.competition, "never-collected")
        self.assertEqual(view.status.agents, [])
        self.assertIsNone(view.status.thresholds)
        self.assertIsNone(view.captured_at)

    def test_history_pages_dates_and_exact_snapshot_stay_competition_scoped(self):
        old = self.save_run(stamp="2026-09-17T00:00:00Z", score=700)
        latest = self.save_run(stamp="2026-09-18T00:00:00Z", score=900)
        foreign = self.save_run("other-contest", stamp="2026-09-19T00:00:00Z", score=1000)
        page = self.manager.arena_history("ended-contest", offset=1, limit=1)
        self.assertEqual(page["total"], 2)
        self.assertEqual(page["logs"][0].id, old.id)
        day = self.manager.arena_history("ended-contest", day="2026-09-18")
        self.assertEqual([log.id for log in day["logs"]], [latest.id])
        exact = self.manager.arena_snapshot("ended-contest", old.id)
        self.assertEqual(exact.run_id, old.id)
        self.assertEqual(exact.status.agents[0].score, 700)
        with self.assertRaises(LookupError):
            self.manager.arena_snapshot("ended-contest", foreign.id)
        self.assertEqual(self.manager._config.competition, "current-contest")

    def test_corrupt_selected_snapshot_fails_instead_of_silently_selecting_another(self):
        log = self.save_run()
        self.manager.arena_history("ended-contest")
        self.manager._run_detail_path(log.id).write_text("broken", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.manager.arena_snapshot("ended-contest", log.id)

    def test_history_route_validation_and_404(self):
        log = self.save_run()
        app = FastAPI()
        app.state.simulation_monitor = self.manager
        app.include_router(router)
        with TestClient(app) as client:
            path = "/api/simulation-monitor/arena/history?competition=ended-contest"
            self.assertEqual(client.get(path).json()["logs"][0]["id"], log.id)
            self.assertEqual(client.get(path + "&day=2026-02-31").status_code, 422)
            self.assertEqual(client.get(path + "&offset=-1").status_code, 422)
            self.assertEqual(client.get("/api/simulation-monitor/arena", params={"competition": "other-contest", "run_id": log.id}).status_code, 404)

    def test_latest_capture_uses_timestamp_and_does_not_mutate_cached_data(self):
        self.save_run(stamp="2026-09-18T08:00:00+08:00", score=801)
        self.save_run(stamp="2026-09-18T00:30:00Z", score=802)
        self.save_run(stamp="2026-09-17T23:59:00Z", score=700)
        view = self.manager.arena_snapshot("ended-contest")
        self.assertEqual(view.status.agents[0].score, 802)
        view.status.agents[0].score = -1
        self.assertEqual(self.manager.arena_snapshot("ended-contest").status.agents[0].score, 802)

    def test_corrupt_latest_body_falls_back_with_warning(self):
        self.save_run(score=800)
        newest = self.save_run(stamp="2026-09-19T00:00:00Z", score=900)
        path = self.manager._run_detail_path(newest.id)
        path.write_text('{"log":' + newest.model_dump_json() + ',"agents":[broken', encoding="utf-8")
        view = self.manager.arena_snapshot("ended-contest")
        self.assertEqual(view.status.agents[0].score, 800)
        self.assertTrue(view.warning)

    def test_unrelated_histories_are_indexed_without_reading_their_bodies(self):
        self.save_run()
        other = self.save_run("other-contest")
        self.manager._run_detail_path(other.id).write_text(
            '{"log":' + other.model_dump_json() + ',"agents":[invalid body', encoding="utf-8",
        )
        view = self.manager.arena_snapshot("ended-contest")
        self.assertEqual(view.status.agents[0].score, 800)
        self.assertIsNone(view.warning)

    def test_failed_persistence_keeps_previous_history_and_retry_is_visible(self):
        self.save_run(score=800)
        self.manager.arena_snapshot("ended-contest")  # warm index/cache
        with patch.object(Path, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.save_run(stamp="2026-09-19T00:00:00Z", score=900)
        self.assertEqual(self.manager.arena_snapshot("ended-contest").status.agents[0].score, 800)
        self.save_run(stamp="2026-09-20T00:00:00Z", score=950)
        self.assertEqual(self.manager.arena_snapshot("ended-contest").status.agents[0].score, 950)

    def test_unattributed_history_is_not_assumed_to_belong_to_default_competition(self):
        log = self.save_run("pokemon-tcg-ai-battle")
        path = self.manager._run_detail_path(log.id)
        payload = json.loads(path.read_text(encoding="utf-8"))
        del payload["log"]["competition"]
        path.write_text(json.dumps(payload), encoding="utf-8")
        view = self.manager.arena_snapshot("pokemon-tcg-ai-battle")
        self.assertEqual(view.status.agents, [])
        self.assertTrue(view.warning)

    def test_route_is_read_only_validates_slug_and_reports_io_failure(self):
        self.save_run()
        app = FastAPI()
        app.state.simulation_monitor = self.manager
        app.include_router(router)
        with TestClient(app) as client:
            response = client.get("/api/simulation-monitor/arena", params={"competition": "ended-contest"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["source"], "history")
            self.assertEqual(response.json()["monitored_competition"], "current-contest")
            self.assertEqual(self.manager._config.competition, "current-contest")
            self.assertEqual(client.get("/api/simulation-monitor/arena?competition=../invalid").status_code, 422)
            with patch.object(self.manager._history_reader, "latest", side_effect=OSError("unavailable")):
                self.assertEqual(client.get("/api/simulation-monitor/arena?competition=ended-contest").status_code, 503)


if __name__ == "__main__":
    unittest.main()
