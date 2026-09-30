import importlib.util
import json
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
spec = importlib.util.spec_from_file_location('wechat_bridge', ROOT / 'scripts' / 'wechat_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
from harvester.notification.wechat_transport import send
from harvester.simulation.clawbot import ClawbotService


class BridgeTests(unittest.TestCase):
    def test_outbox_receipt_required_and_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'HARVEST_ROOT': tmp}):
            root = Path(tmp) / '_cache'
            bridge.write_json(root / 'clawbot_health.json', {'checked_at': bridge.now(), 'delivery_configured': True})
            key = hashlib.sha256(b'event-1').hexdigest()
            response = root / 'wechat_outbox' / (key + '.result.json')
            with self.assertRaisesRegex(RuntimeError, '回执超时'):
                send({'id': 'event-1', 'text': '**hello**'}, timeout=0)
            payload = json.loads((response.parent / (key + '.json')).read_text())
            self.assertNotIn('*', payload['text'])
            bridge.write_json(response, {'status': 'uncertain', 'error': 'platform denied'})
            with self.assertRaisesRegex(RuntimeError, 'platform denied'):
                send({'id': 'event-1', 'text': '**hello**'}, timeout=1)
            bridge.write_json(response, {'status': 'accepted', 'message_id': 'receipt'})
            send({'id': 'event-1', 'text': '**hello**'}, timeout=1)
            with self.assertRaisesRegex(RuntimeError, '不同内容'):
                send({'id': 'event-1', 'text': 'changed'}, timeout=1)

    def test_definitive_rejection_requires_new_bounded_attempt(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'HARVEST_ROOT': tmp}):
            root = Path(tmp) / '_cache'
            bridge.write_json(root / 'clawbot_health.json', {'checked_at': bridge.now(), 'delivery_configured': True})
            key = hashlib.sha256(b'event-2').hexdigest()
            path = root / 'wechat_outbox' / (key + '.json')
            with self.assertRaises(RuntimeError): send({'id': 'event-2', 'text': 'hello'}, timeout=0)
            bridge.write_json(path.with_suffix('.result.json'), {'status': 'failed', 'attempt': 0})
            with self.assertRaises(RuntimeError): send({'id': 'event-2', 'text': 'hello'}, timeout=0)
            self.assertEqual(bridge.read_json(path)['attempt'], 1)
            with patch.object(bridge, 'send_message', return_value={'status': 'accepted', 'message_id': 'receipt'}) as sender:
                bridge.process_one(path, SimpleNamespace(home=Path(tmp), plugin=Path(tmp)), str, sender)
                bridge.process_one(path, SimpleNamespace(home=Path(tmp), plugin=Path(tmp)), str, sender)
                self.assertEqual(sender.call_count, 1)
            send({'id': 'event-2', 'text': 'hello'}, timeout=1)

    def test_worker_does_not_send_twice_or_resend_unknown_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            key = hashlib.sha256(b'one').hexdigest()
            path = Path(tmp) / (key + '.json')
            bridge.write_json(path, {'id': 'one', 'text': 'hello'})
            args = SimpleNamespace(home=Path(tmp), plugin=Path(tmp))
            with patch.object(bridge, 'send_message') as sender:
                sender.return_value = {'status': 'accepted', 'message_id': 'test'}
                bridge.process_one(path, args, str, sender)
                bridge.process_one(path, args, str, sender)
                self.assertEqual(sender.call_count, 1)
                path.with_suffix('.result.json').unlink()
                bridge.process_one(path, args, str, sender)
                self.assertEqual(sender.call_count, 1)
                self.assertEqual(bridge.read_json(path.with_suffix('.result.json'))['status'], 'uncertain')

    def test_only_bound_owner_with_context_and_official_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = home / '.openclaw' / 'openclaw-weixin'
            bridge.write_json(root / 'accounts.json', ['account'])
            bridge.write_json(root / 'accounts' / 'account.json', {'userId': 'owner', 'token': 'fake-token', 'baseUrl': 'https://attacker.invalid'})
            bridge.write_json(root / 'accounts' / 'account.context-tokens.json', {'owner': 'fake-context'})
            with patch.object(bridge.request, 'build_opener') as opener:
                with self.assertRaisesRegex(ValueError, '官方地址'):
                    bridge.send_message(home, home, 'test', 'id')
                opener.assert_not_called()
            bridge.write_json(root / 'accounts.json', ['account', 'another'])
            with self.assertRaisesRegex(ValueError, '唯一'):
                bridge.recipient(home)

    def test_status_uses_host_snapshot_without_network_and_expires(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'HARVEST_ROOT': tmp}), patch.object(ClawbotService, 'probe_gateway', side_effect=AssertionError('no background network')):
            path = Path(tmp) / '_cache' / 'clawbot_health.json'
            data = {'checked_at': bridge.now(), 'gateway_ok': True, 'wechat_running': True, 'wechat_configured': True, 'business_api_ok': True}
            bridge.write_json(path, data)
            status = ClawbotService.get_status()
            self.assertTrue(status.wechat_running)
            self.assertTrue(status.is_online)
            data['checked_at'] = (datetime.now(timezone.utc) - timedelta(seconds=100)).isoformat()
            bridge.write_json(path, data)
            self.assertIsNone(ClawbotService.get_status().wechat_running)
            self.assertEqual(ClawbotService.get_status().status_source, 'stale')


if __name__ == '__main__':
    unittest.main()
