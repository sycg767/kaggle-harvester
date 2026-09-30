from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from harvester.simulation.clawbot import ClawbotService


class ClawbotSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.cache = self.root / '_cache'
        self.cache.mkdir()
        self.env = patch.dict(os.environ, {'HARVEST_ROOT': str(self.root), 'USERPROFILE': str(self.root), 'HOME': str(self.root)}, clear=True)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def snapshot(self, age=0, **values):
        data = {'checked_at': (datetime.now(timezone.utc) - timedelta(seconds=age)).isoformat(),
                'gateway_ok': True, 'wechat_configured': True, 'wechat_running': True,
                'business_api_ok': True, 'model': 'observed-model', 'error': None, **values}
        (self.cache / 'clawbot_health.json').write_text(json.dumps(data), encoding='utf-8')

    def test_status_read_never_uses_network_and_reports_independent_layers(self):
        self.snapshot(gateway_ok=False, business_api_ok=False)
        with patch('socket.create_connection', side_effect=AssertionError('no network')):
            result = ClawbotService.get_status(force=True)
        self.assertFalse(result.is_online)
        self.assertFalse(result.gateway_ok)
        self.assertTrue(result.wechat_running)
        self.assertFalse(result.business_api_ok)
        self.assertIsNone(result.gateway_reachable)
        self.assertEqual(result.model, 'observed-model')

    def test_expired_snapshot_is_unknown_even_after_previous_fresh_read(self):
        self.snapshot()
        self.assertTrue(ClawbotService.get_status().is_online)
        self.snapshot(age=91)
        status = ClawbotService.get_status()
        self.assertEqual(status.status_source, 'stale')
        self.assertFalse(status.is_online)
        self.assertIsNone(status.wechat_running)
        self.assertIsNone(status.gateway_ok)

    def test_missing_and_invalid_snapshot_do_not_invent_model_or_plugin_state(self):
        for raw in (None, '{bad', '[]', '{"checked_at": "invalid"}'):
            path = self.cache / 'clawbot_health.json'
            if raw is not None:
                path.write_text(raw, encoding='utf-8')
            status = ClawbotService.get_status()
            self.assertEqual(status.status_source, 'unknown')
            self.assertIsNone(status.wechat_running)
            self.assertIsNone(status.model)

    def test_manual_tcp_failure_does_not_override_wechat_snapshot(self):
        self.snapshot()
        with patch.object(ClawbotService, 'probe_gateway', return_value=False):
            result = ClawbotService.test_gateway()
        self.assertFalse(result.success)
        self.assertFalse(result.status.gateway_reachable)
        self.assertTrue(result.status.wechat_running)
        self.assertTrue(result.status.is_online)

    def test_dns_delay_is_bounded_by_total_probe_timeout(self):
        def slow_resolver(*args, **kwargs):
            time.sleep(.3)
            raise OSError('resolver timeout')
        start = time.perf_counter()
        with patch('socket.create_connection', side_effect=slow_resolver):
            self.assertFalse(ClawbotService.probe_gateway('example.invalid', 18789, timeout=.02))
        self.assertLess(time.perf_counter() - start, .2)

    def test_non_boolean_snapshot_values_are_not_treated_as_true(self):
        self.snapshot(gateway_ok='false', wechat_running=1)
        status = ClawbotService.get_status()
        self.assertIsNone(status.gateway_ok)
        self.assertIsNone(status.wechat_running)


if __name__ == '__main__':
    unittest.main()
