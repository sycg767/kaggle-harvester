from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from harvester.models import CompetitionSubmission, SimulationEpisode, SimulationMedalThresholds, SimulationMonitorConfig
from harvester.simulation.agent_stats import calculate_agent_stats


class AgentStatsProvenanceTests(unittest.TestCase):
    def calculate(self, submission, episodes=None):
        return calculate_agent_stats(
            sub=submission, episodes=episodes or [], comp='pokemon-tcg-ai-battle',
            leaderboard_rows=[{'TeamName': 'GrimmsnaRL', 'Score': '900'}, {'TeamName': 'Observed team', 'Score': '850'}],
            team_ranks={'grimmsnarl': 1, 'observed team': 2},
            team_scores={'grimmsnarl': 900.0, 'observed team': 850.0},
            thresholds=SimulationMedalThresholds(bronze_cutoff_score=800.0, bronze_cutoff_rank=10),
            config=SimulationMonitorConfig(), checked_time='2026-10-01T00:00:00Z',
        )

    def test_known_submission_ids_without_observations_remain_unknown(self):
        for submission_id in ('55565346', '55555162', '12345'):
            with self.subTest(submission_id=submission_id):
                stats, history = self.calculate(CompetitionSubmission(ref=submission_id))
                self.assertEqual(stats.team_name, '')
                self.assertIsNone(stats.score)
                self.assertIsNone(stats.public_score)
                self.assertIsNone(stats.rank)
                self.assertIsNone(stats.bronze_gap_score)
                self.assertIsNone(stats.tier_cushion_score)
                self.assertEqual(stats.medal_tier, 'unknown')
                self.assertEqual(stats.rating_trajectory, [])
                self.assertIsNone(history.score)
                self.assertIsNone(history.rank)

    def test_observed_team_can_supply_leaderboard_score(self):
        stats, _ = self.calculate(CompetitionSubmission(ref='55565346', team_name='Observed team'))
        self.assertEqual(stats.score, 850.0)
        self.assertEqual(stats.team_name, 'Observed team')
        self.assertEqual(stats.rank, 2)

    def test_episode_team_identity_can_supply_leaderboard_score(self):
        stats, _ = self.calculate(CompetitionSubmission(ref='55555162'), [
            SimulationEpisode(id=1, my_submission_id=55555162, my_team_name='Observed team')])
        self.assertEqual(stats.score, 850.0)
        self.assertEqual(stats.team_name, 'Observed team')

    def test_unmatched_real_team_remains_unknown(self):
        stats, _ = self.calculate(CompetitionSubmission(ref='55565346', team_name='Another team'))
        self.assertEqual(stats.team_name, 'Another team')
        self.assertIsNone(stats.score)
        self.assertIsNone(stats.rank)

    def test_observed_zero_score_is_not_replaced_by_team_score(self):
        stats, _ = self.calculate(CompetitionSubmission(ref='55565346', team_name='Observed team', public_score=0.0))
        self.assertEqual(stats.score, 0.0)


if __name__ == '__main__':
    unittest.main()
