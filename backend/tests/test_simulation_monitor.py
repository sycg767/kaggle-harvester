from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from harvester.kaggle_client import KaggleClient
from harvester.models import (
    CompetitionSubmission,
    SimulationAgentStats,
    SimulationEpisode,
    SimulationEpisodeAgent,
    SimulationMedalThresholds,
    SimulationMonitorConfig,
)
from harvester.simulation_monitor import SimulationMonitorManager


class FakeKaggleClient:
    def __init__(self) -> None:
        self.competition_slug = "pokemon-tcg-ai-battle"

    def list_competition_submissions(
        self, competition: str | None = None, page_size: int = 20
    ) -> list[CompetitionSubmission]:
        return [
            CompetitionSubmission(
                ref="55565346",
                file_name="p46_submission.tar.gz",
                description="p46 candidate model",
                status="COMPLETE",
                team_name="GrimmsnaRL",
                public_score=862.8,
                date="2026-08-16 23:43:23",
            ),
            CompetitionSubmission(
                ref="55555162",
                file_name="p3plus31_submission.tar.gz",
                description="p3plus31 candidate model",
                status="COMPLETE",
                team_name="GrimmsnaRL",
                public_score=772.8,
                date="2026-08-16 14:15:57",
            ),
        ]

    def list_simulation_episodes(
        self, submission_id: int, competition: str = "pokemon-tcg-ai-battle"
    ) -> list[SimulationEpisode]:
        if submission_id == 55565346:
            # 3 wins, 2 losses = 5 matches (60.0% win rate)
            return [
                SimulationEpisode(
                    id=1001,
                    create_time="2026-08-17T10:00:00Z",
                    state="COMPLETED",
                    agents=[
                        SimulationEpisodeAgent(submission_id=55565346, team_name="GrimmsnaRL", reward=1.0, index=0),
                        SimulationEpisodeAgent(submission_id=88888, team_name="Opponent A", reward=-1.0, index=1),
                    ],
                    my_agent_index=0,
                    my_submission_id=55565346,
                    my_team_name="GrimmsnaRL",
                    opponent_team_name="Opponent A",
                    opponent_submission_id=88888,
                    result="win",
                    reward=1.0,
                    replay_url="https://www.kaggle.com/competitions/pokemon-tcg-ai-battle/leaderboard?dialog=episodes-episode-1001",
                ),
                SimulationEpisode(
                    id=1002,
                    create_time="2026-08-17T09:00:00Z",
                    state="COMPLETED",
                    agents=[
                        SimulationEpisodeAgent(submission_id=55565346, team_name="GrimmsnaRL", reward=1.0, index=0),
                        SimulationEpisodeAgent(submission_id=88889, team_name="Opponent B", reward=-1.0, index=1),
                    ],
                    my_agent_index=0,
                    my_submission_id=55565346,
                    my_team_name="GrimmsnaRL",
                    opponent_team_name="Opponent B",
                    result="win",
                    reward=1.0,
                ),
                SimulationEpisode(
                    id=1003,
                    create_time="2026-08-17T08:00:00Z",
                    state="COMPLETED",
                    agents=[
                        SimulationEpisodeAgent(submission_id=55565346, team_name="GrimmsnaRL", reward=1.0, index=0),
                        SimulationEpisodeAgent(submission_id=88890, team_name="Opponent C", reward=-1.0, index=1),
                    ],
                    my_agent_index=0,
                    my_submission_id=55565346,
                    my_team_name="GrimmsnaRL",
                    opponent_team_name="Opponent C",
                    result="win",
                    reward=1.0,
                ),
                SimulationEpisode(
                    id=1004,
                    create_time="2026-08-17T07:00:00Z",
                    state="COMPLETED",
                    agents=[
                        SimulationEpisodeAgent(submission_id=55565346, team_name="GrimmsnaRL", reward=-1.0, index=0),
                        SimulationEpisodeAgent(submission_id=88891, team_name="Opponent D", reward=1.0, index=1),
                    ],
                    my_agent_index=0,
                    my_submission_id=55565346,
                    my_team_name="GrimmsnaRL",
                    opponent_team_name="Opponent D",
                    result="loss",
                    reward=-1.0,
                ),
                SimulationEpisode(
                    id=1005,
                    create_time="2026-08-17T06:00:00Z",
                    state="COMPLETED",
                    agents=[
                        SimulationEpisodeAgent(submission_id=55565346, team_name="GrimmsnaRL", reward=-1.0, index=0),
                        SimulationEpisodeAgent(submission_id=88892, team_name="Opponent E", reward=1.0, index=1),
                    ],
                    my_agent_index=0,
                    my_submission_id=55565346,
                    my_team_name="GrimmsnaRL",
                    opponent_team_name="Opponent E",
                    result="loss",
                    reward=-1.0,
                ),
            ]
        return []

    def get_simulation_leaderboard(
        self, competition: str = "pokemon-tcg-ai-battle", bronze_percentile: float = 0.10
    ) -> tuple[SimulationMedalThresholds, list[dict]]:
        # Mock 1000 teams
        total = 1000
        gold_rank = 12
        silver_rank = 50
        bronze_rank = 100
        thresholds = SimulationMedalThresholds(
            total_teams=total,
            gold_cutoff_rank=gold_rank,
            gold_cutoff_score=1200.0,
            silver_cutoff_rank=silver_rank,
            silver_cutoff_score=1050.0,
            bronze_cutoff_rank=bronze_rank,
            bronze_cutoff_score=840.0,
            bronze_percentile=bronze_percentile,
        )
        rows = [
            {"TeamId": "999", "TeamName": "GrimmsnaRL", "Score": "862.8"},
        ]
        return thresholds, rows


class TestSimulationMonitor(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = self.temp_dir.name
        self.client = FakeKaggleClient()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_run_once_sync_computation(self) -> None:
        manager = SimulationMonitorManager(
            kaggle_client=self.client,  # type: ignore[arg-type]
            harvest_root=self.root,
            default_competition="pokemon-tcg-ai-battle",
        )
        config = SimulationMonitorConfig(
            enabled=True,
            competition="pokemon-tcg-ai-battle",
            bronze_percentile=0.10,
        )
        status, agents, thresholds, new_eps, hist, notifs = manager._run_once_sync(config)
        self.assertEqual(len(agents), 2)
        # Agent 1 (55565346)
        agent1 = agents[0]
        self.assertEqual(agent1.submission_id, 55565346)
        self.assertEqual(agent1.total_episodes, 5)
        self.assertEqual(agent1.wins, 3)
        self.assertEqual(agent1.losses, 2)
        self.assertEqual(agent1.win_rate, 60.0)
        # Score 862.8 vs Bronze cutoff 840.0 -> Gap = +22.8
        self.assertIsNotNone(agent1.bronze_gap_score)
        self.assertAlmostEqual(agent1.bronze_gap_score, 22.8, places=1)
        # Medal tier: Rank 1 <= Gold (12) -> Gold
        self.assertEqual(agent1.medal_tier, "gold")

        # Thresholds
        self.assertIsNotNone(thresholds)
        self.assertEqual(thresholds.total_teams, 1000)
        self.assertEqual(thresholds.bronze_cutoff_rank, 100)
        self.assertEqual(thresholds.bronze_cutoff_score, 840.0)

    def test_run_now_persistence_and_detail(self) -> None:
        manager = SimulationMonitorManager(
            kaggle_client=self.client,  # type: ignore[arg-type]
            harvest_root=self.root,
            default_competition="pokemon-tcg-ai-battle",
        )
        snapshot = asyncio.run(manager.run_now(trigger="manual"))
        self.assertEqual(snapshot.status.competition, "pokemon-tcg-ai-battle")
        self.assertEqual(len(snapshot.logs), 1)
        log = snapshot.logs[0]
        self.assertEqual(log.outcome, "success")
        self.assertTrue(log.details_available)

        # Retrieve detail
        detail = manager.get_run_detail(log.id)
        self.assertIsNotNone(detail)
        self.assertEqual(len(detail.agents), 2)
        self.assertEqual(detail.agents[0].submission_id, 55565346)
        self.assertEqual(len(detail.agents[0].recent_episodes), 5)


if __name__ == "__main__":
    unittest.main()
