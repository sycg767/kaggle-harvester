import sys
import unittest
import importlib
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from harvester import wechat_bot as bot


class WechatBotTests(unittest.TestCase):
    def fixture(self):
        return {'config': {'enabled': True, 'interval_minutes': 10, 'competition': 'pokemon-tcg-ai-battle'},
                'status': {'last_checked_at': '2026-10-01T00:00:00Z', 'agents': [
                    {'alias': '**alpha_agent**', 'score': 0, 'public_score': 50, 'rank': 3,
                     'medal_tier': 'gold', 'wins': 1, 'losses': 0, 'ties': 0, 'win_rate': 100,
                     'last_updated': '2026-10-01T00:00:00Z',
                     'recent_episodes': [{'result': 'unknown', 'score_delta': -2.5,
                                          'opponent_team_name': 'other_agent',
                                          'end_time': '2026-10-01T00:00:00Z'}] * 20}]}}

    def test_time_zones(self):
        for raw in ['2026-08-20T03:10:00Z', '2026-08-20T11:10:00+08:00', '2026-08-20T11:10:00']:
            self.assertEqual(bot.format_beijing_time(raw), '11:10')
        self.assertEqual(bot.format_beijing_time('2026-08-20T00:10:00-03:00', True), '2026-08-20 11:10')

    def test_nonempty_zero_unknown_and_concise(self):
        text = bot.format_message(self.fixture(), now=datetime(2026, 10, 1, 0, 1, tzinfo=timezone.utc), details=True)
        self.assertIn('第 3 名，0.0 分', text)
        self.assertIn('alpha_agent', text)
        self.assertIn('金牌区', text)
        self.assertEqual(text.count('other_agent'), 1)
        self.assertIn('结果未知', text)
        self.assertIn('-2.5分', text)
        self.assertNotIn('**', text)
        self.assertNotIn('实时', text)
        self.assertIn('2026-10-01 08:00', text)

    def test_unknown_score_not_zero(self):
        data = self.fixture()
        data['status']['agents'][0].update(score=None, public_score=None, rank=None)
        text = bot.format_message(data)
        self.assertIn('未知 分', text)
        self.assertIn('排名未知', text)
        self.assertNotIn('0.0 分', text)

    def test_quick_report_has_visual_groups_without_detail_noise(self):
        data = self.fixture()
        data['status']['agents'].append(dict(data['status']['agents'][0], alias='beta', medal_tier='silver'))
        text = bot.format_message(data, now=datetime(2026, 10, 1, 0, 1, tzinfo=timezone.utc))
        self.assertIn('🥇 alpha_agent', text)
        self.assertIn('🥈 beta', text)
        self.assertIn('0.0 分 · 第 3 名', text)
        self.assertNotIn('other_agent', text)
        self.assertNotIn('快照最佳排名', text)
        self.assertNotIn('发送“流水”', text)
        self.assertNotIn('1胜 / 0负', text)
        self.assertLess(len(text), 260)
        self.assertEqual(text.count('🕒'), 1)
        self.assertIn('other_agent', bot.format_message(data, details=True))

    def test_empty(self):
        self.assertIn('暂无战报', bot.format_message({}))
        self.assertIn('尚无记录', bot.format_message({}))

    def test_old_failed_and_disabled(self):
        data = self.fixture()
        data['config']['enabled'] = False
        data['status']['last_error'] = 'connection failed'
        text = bot.format_message(data, now=datetime(2026, 10, 2, tzinfo=timezone.utc))
        for expected in ['监控已停', '同步失败', '旧数据']:
            self.assertIn(expected, text)

    def test_history_limits(self):
        self.assertEqual(bot.format_message(self.fixture(), history_only=True).count('other_agent'), 5)
        self.assertEqual(bot.format_message(self.fixture(), history_only=True, limit=100).count('other_agent'), 15)

    def test_sanitize(self):
        self.assertEqual(bot.sanitize_plain_text('# 标题\n**重点**\n- -2.5 agent_name\n[详情](https://example.com)'),
                         '标题\n重点\n· -2.5 agent_name\n详情（https://example.com）')
        self.assertEqual(bot.sanitize_plain_text('__重点__ agent__name -2.5'), '重点 agent__name -2.5')

    def test_recent_check_does_not_hide_old_agent_data(self):
        data = self.fixture()
        data['status']['last_checked_at'] = '2026-10-02T00:00:00Z'
        text = bot.format_message(data, now=datetime(2026, 10, 2, tzinfo=timezone.utc))
        self.assertIn('旧数据', text)

    def test_import_has_no_network(self):
        with patch.object(bot.urllib.request, 'urlopen', side_effect=AssertionError('network')):
            importlib.reload(bot)

    def test_probe_is_authenticated(self):
        response = MagicMock()
        response.__enter__.return_value.status = 200
        with patch.object(bot, 'load_config_value', side_effect=lambda key: 'secret' if key == 'HARVESTER_API_KEY' else ''), patch.object(bot.urllib.request, 'urlopen', return_value=response) as opened:
            bot._resolve_api_url()
        self.assertEqual(opened.call_args[0][0].get_header('X-harvester-key'), 'secret')

    def test_refresh_posts_then_gets_without_enabling(self):
        import json
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(self.fixture()).encode()
        with patch.object(bot.urllib.request, 'urlopen', return_value=response) as opened:
            bot._fetch_snapshot('http://localhost/api/simulation-monitor', refresh=True)
        requests = [call[0][0] for call in opened.call_args_list]
        self.assertEqual([request.get_method() for request in requests], ['POST', 'GET'])
        self.assertTrue(requests[0].full_url.endswith('/run'))
        self.assertEqual(requests[0].data, b'')

    def test_refresh_http_error_is_not_silent(self):
        error = urllib.error.HTTPError('http://localhost', 409, 'busy', {}, None)
        with patch.object(bot.urllib.request, 'urlopen', side_effect=error):
            with self.assertRaisesRegex(RuntimeError, '已有检查正在执行'):
                bot._fetch_snapshot('http://localhost', refresh=True)

    def test_refresh_failed_snapshot_is_not_success(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"status":{"last_error":"failed"}}'
        with patch.object(bot.urllib.request, 'urlopen', return_value=response):
            with self.assertRaisesRegex(RuntimeError, '本次同步未完成'):
                bot._fetch_snapshot('http://localhost', refresh=True)

    def test_failed_api_does_not_create_manager(self):
        with patch.object(bot.urllib.request, 'urlopen', side_effect=urllib.error.URLError('down')):
            with self.assertRaisesRegex(RuntimeError, '无法访问战报服务'):
                bot._fetch_snapshot('http://localhost')


if __name__ == '__main__':
    unittest.main()
