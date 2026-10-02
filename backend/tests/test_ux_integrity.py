from __future__ import annotations

import asyncio
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from harvester.models import SimulationAgentStats, SimulationMonitorConfig, SimulationMonitorStatus
from harvester.simulation_monitor import SimulationMonitorManager, SimulationMonitorBusyError
from harvester.notification.manager import NotificationManager
from harvester.schemas.notifications import NotificationConfig
from routers.simulation_monitor import router


class SimulationIntegrityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.manager = SimulationMonitorManager(SimpleNamespace(), self.temp.name, 'contest-a')
        self.manager._status = SimulationMonitorStatus(
            competition='contest-a', last_checked_at='2026-09-01T00:00:00Z',
            last_success_at='2026-09-01T00:00:00Z',
            agents=[SimulationAgentStats(submission_id=10, score=700, last_updated='2026-09-01T00:00:00Z')],
        )
        self.manager._save_state()
        self.claw = patch.object(self.manager, '_get_clawbot_status', return_value=None)
        self.claw.start()
        self.addCleanup(self.claw.stop)

    async def test_running_collection_cannot_be_reassigned_to_another_competition(self):
        entered, release = threading.Event(), threading.Event()
        def collect(*args, **kwargs):
            entered.set()
            if not release.wait(3): raise RuntimeError('test release missing')
            status = self.manager._status.model_copy(deep=True)
            status.last_checked_at = '2026-10-03T00:00:00Z'
            return status, status.agents, None, 0, [], []
        with patch.object(self.manager, '_run_once_sync', side_effect=collect):
            task = asyncio.create_task(self.manager.run_now())
            try:
                await asyncio.to_thread(entered.wait, 2)
                with self.assertRaises(SimulationMonitorBusyError):
                    await self.manager.update_config(SimulationMonitorConfig(competition='contest-b'))
            finally:
                release.set()
            result = await task
        self.assertEqual(result.config.competition, 'contest-a')
        self.assertEqual(result.status.competition, 'contest-a')
        await self.manager.update_config(SimulationMonitorConfig(competition='contest-b'))
        self.assertEqual(self.manager._status.agents, [])
        self.assertIsNone(self.manager._status.last_success_at)

    async def test_failure_retains_data_time_across_restart(self):
        with patch.object(self.manager, '_run_once_sync', side_effect=RuntimeError('upstream down')):
            result = await self.manager.run_now()
        self.assertEqual(result.logs[0].outcome, 'failed')
        self.assertEqual(result.status.agents[0].score, 700)
        self.assertEqual(result.status.last_success_at, '2026-09-01T00:00:00Z')
        self.assertNotEqual(result.status.last_checked_at, result.status.last_success_at)
        restarted = SimulationMonitorManager(SimpleNamespace(), self.temp.name)
        self.assertEqual(restarted.arena_snapshot('contest-a').captured_at, '2026-09-01T00:00:00+00:00')

    async def test_unknown_legacy_data_time_is_not_replaced_by_attempt_time(self):
        self.manager._status.last_success_at = None
        self.manager._status.agents[0].last_updated = None
        self.assertIsNone(self.manager.arena_snapshot().captured_at)

    async def test_configuration_disk_failure_rolls_back_memory_and_survives_restart(self):
        before = self.manager._state_path.read_bytes()
        with patch.object(self.manager, '_save_state', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                await self.manager.update_config(SimulationMonitorConfig(competition='contest-b', enabled=True))
        self.assertEqual(self.manager._config.competition, 'contest-a')
        self.assertEqual(self.manager._status.agents[0].score, 700)
        self.assertEqual(self.manager._state_path.read_bytes(), before)
        self.assertEqual(SimulationMonitorManager(SimpleNamespace(), self.temp.name)._config.competition, 'contest-a')

    async def test_timed_out_worker_blocks_config_and_second_run_until_exit(self):
        release = threading.Event()
        def collect(*args, **kwargs):
            release.wait(2)
            raise RuntimeError('background work completed')
        with patch.object(self.manager, '_run_once_sync_impl', side_effect=collect), patch('harvester.simulation_monitor.SIMULATION_CHECK_TIMEOUT_SECONDS', 0.02):
            try:
                await self.manager.run_now()
                self.assertTrue(self.manager.snapshot().status.running)
                self.assertTrue(self.manager.health_status()["running"])
                with self.assertRaises(SimulationMonitorBusyError):
                    await self.manager.update_config(SimulationMonitorConfig(competition='contest-b'))
                with self.assertRaises(SimulationMonitorBusyError):
                    await self.manager.run_now()
            finally:
                release.set()
                for _ in range(100):
                    if not self.manager._sync_run_lock.locked(): break
                    await asyncio.sleep(0.01)

    async def test_busy_and_persistence_failures_have_actionable_http_statuses(self):
        app = FastAPI()
        app.state.simulation_monitor = self.manager
        app.include_router(router)
        with TestClient(app) as client:
            self.manager._sync_run_lock.acquire()
            try:
                response = client.put('/api/simulation-monitor', json={'competition': 'contest-b'})
                self.assertEqual(response.status_code, 409)
            finally:
                self.manager._sync_run_lock.release()
            with patch.object(self.manager, '_save_state', side_effect=OSError('disk full')):
                self.assertEqual(client.put('/api/simulation-monitor', json={'competition': 'contest-b'}).status_code, 503)


class DeliveryIntegrityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.secrets = SimpleNamespace(storage_mode='session', get=lambda key: 'private-token' if key == 'smtp_password' else '')
        self.manager = NotificationManager(self.temp.name, secret_store=self.secrets)
        self.manager._config = NotificationConfig(wechat_enabled=True, email_enabled=True)
        self.manager.MAX_ATTEMPTS = 1

    async def test_partial_delivery_history_is_safe_persistent_and_retry_skips_success(self):
        event = {'id': 'event-a', 'event': 'simulation', 'competition': 'contest-a', 'text': 'private body', 'channels': ['wechat', 'email']}
        self.manager._pending[event['id']] = event
        calls = []
        def send(channel, _event):
            calls.append(channel)
            if channel == 'wechat': raise RuntimeError('private-token unavailable')
        with patch.object(self.manager, '_send_channel', side_effect=send):
            await self.manager._deliver_event('event-a')
        snap = self.manager.snapshot()
        self.assertEqual(snap.status.pending_count, 1)
        self.assertIn('wechat', snap.status.last_error)
        self.assertEqual({item.state for item in snap.deliveries}, {'failed', 'sent'})
        self.assertNotIn('private-token', snap.model_dump_json())
        self.assertNotIn('private body', snap.model_dump_json())
        restarted = NotificationManager(self.temp.name, secret_store=self.secrets)
        self.assertEqual(len(restarted.snapshot().deliveries), 2)
        with patch.object(restarted, '_send_channel') as sender:
            await restarted._deliver_event('event-a')
            self.assertEqual([call.args[0] for call in sender.call_args_list], ['wechat'])
        self.assertEqual(restarted.snapshot().status.pending_count, 0)
        self.assertEqual(restarted.snapshot().deliveries[0].state, 'sent')

    async def test_delivery_history_is_bounded_and_empty_state_is_honest(self):
        self.assertEqual(self.manager.snapshot().deliveries, [])
        for index in range(205):
            self.manager._record_delivery({'id': str(index), 'event': 'test'}, 'email', 'queued', 0)
        self.manager._save_state()
        restarted = NotificationManager(self.temp.name, secret_store=self.secrets)
        self.assertEqual(len(restarted.snapshot().deliveries), 200)
        self.assertEqual(restarted.snapshot().deliveries[0].event_id, '204')


if __name__ == '__main__':
    unittest.main()
