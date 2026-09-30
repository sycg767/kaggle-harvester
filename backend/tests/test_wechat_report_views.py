import sys
import unittest
from pathlib import Path
from datetime import datetime, timezone
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from harvester import wechat_bot as bot


class ReportViewTests(unittest.TestCase):
    def fixture(self):
        agents = []
        for name, score, rank, results in [('p46', 921.4, 356, ['win', 'win', 'loss', 'win', 'win']), ('p31', 898.2, 448, ['loss', 'win', 'win', 'win', 'loss'])]:
            agents.append({'alias': name, 'score': score, 'rank': rank, 'medal_tier': 'bronze',
                           'wins': 4, 'losses': 1, 'ties': 0, 'last_updated': '2026-10-01T00:00:00Z',
                           'recent_episodes': [{'id': i, 'result': result, 'score_delta': 1.5 if result == 'win' else -4.8,
                                                'opponent_team_name': 'opponent', 'end_time': '2026-10-01T00:00:0%dZ' % (5-i)} for i, result in enumerate(results)]})
        return {'config': {'enabled': True, 'competition': 'pokemon-tcg-ai-battle'},
                'status': {'last_checked_at': '2026-10-01T00:00:06Z', 'agents': agents,
                           'thresholds': {'gold_cutoff_score': 1134, 'silver_cutoff_score': 925.1, 'bronze_cutoff_score': 853.7,
                                          'total_teams': 6807, 'updated_at': '2026-10-01T00:00:00Z'}}}

    def render(self, data=None, **kwargs):
        return bot.format_message(data or self.fixture(), now=datetime(2026, 10, 1, 0, 1, tzinfo=timezone.utc), **kwargs)

    def test_default_includes_evidence_based_commentary_without_prediction(self):
        text = self.render()
        for expected in ['p46 距银牌 3.7 分', '🟢🟢🔴🟢🟢', '4 胜 1 负', '这一轮怎么看', '6807', '925.1']:
            self.assertIn(expected, text)
        for forbidden in ['**', '```', '再赢一场就', '一定', '下一场开赛']:
            self.assertNotIn(forbidden, text)

    def test_history_excludes_system_checks_and_orders_by_end_time(self):
        data = self.fixture()
        a = data['status']['agents'][0]
        a['recent_episodes'].reverse()
        a['recent_episodes'].insert(0, {'is_system_check': True, 'result': 'win', 'opponent_team_name': 'SYSTEM'})
        text = self.render(data, history_only=True)
        self.assertNotIn('SYSTEM', text)
        self.assertLess(text.index('08:00'), text.index('【p31】'))
        self.assertEqual(bot._recent(a)[0]['id'], 0)

    def test_unknown_results_do_not_become_losses(self):
        data = self.fixture()
        data['status']['agents'][0]['recent_episodes'][0]['result'] = 'pending'
        text = self.render(data)
        self.assertIn('❔🟢🔴🟢🟢', text)
        self.assertIn('1 场未定', text)

    def test_views_are_distinct_and_help_needs_no_api(self):
        ranking = self.render(view='ranking')
        self.assertIn('积分与排名', ranking)
        self.assertNotIn('这一轮怎么看', ranking)
        self.assertNotIn('opponent', ranking)
        medals = self.render(view='medals')
        self.assertIn('奖牌门槛', medals)
        self.assertNotIn('最近记录', medals)
        with patch.object(bot, '_fetch_snapshot', side_effect=AssertionError('help must be offline')):
            self.assertIn('走势图', bot.get_status_text(view='help'))

    def test_stale_thresholds_do_not_trigger_excited_focus(self):
        data = self.fixture()
        data['status']['thresholds']['updated_at'] = None
        text = self.render(data)
        self.assertNotIn('🔥', text)
        self.assertNotIn('优先关注', text)
        self.assertIn('门槛采集时间较旧或未知', text)

    def test_nonfinite_numbers_remain_unknown(self):
        for value in [float('nan'), float('inf'), True, None]:
            self.assertEqual(bot._number(value), '未知')

    def test_missing_agent_time_does_not_borrow_another_agents_freshness(self):
        data = self.fixture()
        data['status']['agents'][0]['last_updated'] = None
        text = self.render(data)
        self.assertIn('采集时间未知', text)
        self.assertNotIn('优先关注', text)
        self.assertNotIn('🔥', text)

    def test_old_threshold_warning_and_null_episodes(self):
        data = self.fixture()
        data['status']['thresholds']['updated_at'] = None
        data['status']['agents'][0]['recent_episodes'] = None
        self.assertIn('奖牌线较旧或未更新', self.render(data, view='ranking'))
        self.assertIn('暂无已记录对局', self.render(data))


if __name__ == '__main__': unittest.main()
