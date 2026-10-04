from __future__ import annotations

import asyncio
import json
import tempfile
import time
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
import harvester.simulation_monitor as simulation_monitor_module


class FakeKaggleClient:
    def __init__(self) -> None:
        self.competition_slug = "pokemon-tcg-ai-battle"
        self.include_system_check = False

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
            episodes = [
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
            if self.include_system_check:
                episodes.append(
                    SimulationEpisode(
                        id=1006,
                        create_time="2026-08-17T05:00:00Z",
                        state="COMPLETED",
                        agents=[
                            SimulationEpisodeAgent(submission_id=55565346, team_name="GrimmsnaRL", reward=-1.0, index=0),
                        ],
                        my_agent_index=0,
                        my_submission_id=55565346,
                        my_team_name="GrimmsnaRL",
                        opponent_team_name="对手",
                        result="loss",
                        reward=-1.0,
                        score_delta=-4.9,
                    )
                )
            return episodes
        return []

    def get_simulation_leaderboard(
        self,
        competition: str = "pokemon-tcg-ai-battle",
        bronze_percentile: float = 0.10,
        force_refresh: bool = False,
        **kwargs: Any,
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
        self.assertEqual(len(agent1.rating_trajectory), 5)
        self.assertEqual([point.game_number for point in agent1.rating_trajectory], [1, 2, 3, 4, 5])
        self.assertAlmostEqual(agent1.rating_trajectory[-1].score, 862.8, places=1)
        self.assertEqual(agent1.medal_tier, "gold")
        self.assertIsNotNone(agent1.tier_cushion_score)

        # Thresholds
        self.assertIsNotNone(thresholds)
        self.assertEqual(thresholds.total_teams, 1000)
        self.assertEqual(thresholds.bronze_cutoff_rank, 100)
        self.assertEqual(thresholds.bronze_cutoff_score, 840.0)

    def test_system_check_is_excluded_from_record_stats(self) -> None:
        self.client.include_system_check = True
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
        _, agents, _, _, _, _ = manager._run_once_sync(config)
        agent1 = agents[0]
        self.assertEqual(agent1.total_episodes, 6)
        self.assertEqual(agent1.system_checks, 1)
        self.assertEqual(agent1.wins, 3)
        self.assertEqual(agent1.losses, 2)
        self.assertEqual(agent1.win_rate, 60.0)
        self.assertEqual(len(agent1.rating_trajectory), 5)
        check = next(ep for ep in agent1.recent_episodes if ep.is_system_check)
        self.assertEqual(check.result, "unknown")
        self.assertIsNone(check.reward)
        self.assertIsNone(check.score_delta)


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

    def test_timeout_preserves_previous_agents(self) -> None:
        manager = SimulationMonitorManager(
            kaggle_client=self.client,  # type: ignore[arg-type]
            harvest_root=self.root,
            default_competition="pokemon-tcg-ai-battle",
        )
        baseline = asyncio.run(manager.run_now(trigger="manual"))
        self.assertEqual(len(baseline.status.agents), 2)

        original = manager._run_once_sync_impl

        def slow_run(config):
            time.sleep(0.05)
            return original(config)

        manager._run_once_sync_impl = slow_run  # type: ignore[method-assign]
        previous_check_timeout = simulation_monitor_module.SIMULATION_CHECK_TIMEOUT_SECONDS
        try:
            simulation_monitor_module.SIMULATION_CHECK_TIMEOUT_SECONDS = 0.01
            timed_out = asyncio.run(manager.run_now(trigger="manual"))
        finally:
            simulation_monitor_module.SIMULATION_CHECK_TIMEOUT_SECONDS = previous_check_timeout

        self.assertEqual(len(timed_out.status.agents), 2)
        self.assertIn("已保留上次成功数据", timed_out.status.last_error or "")

    def test_custom_target_submission_ids(self) -> None:
        manager = SimulationMonitorManager(
            kaggle_client=self.client,  # type: ignore[arg-type]
            harvest_root=self.root,
            default_competition="pokemon-tcg-ai-battle",
        )
        config = SimulationMonitorConfig(
            enabled=True,
            competition="pokemon-tcg-ai-battle",
            target_submission_ids=[55565346, 55555162],
        )
        status, agents, thresholds, new_eps, hist, notifs = manager._run_once_sync(config)
        self.assertEqual(len(agents), 2)
        self.assertEqual(agents[0].submission_id, 55565346)
        self.assertEqual(agents[1].submission_id, 55555162)

    def test_ended_competition_is_frozen(self) -> None:
        entered_path = Path(self.root) / "_cache" / "entered_competitions.json"
        entered_path.parent.mkdir(parents=True, exist_ok=True)
        entered_path.write_text(
            json.dumps({"items": [{"id": "pokemon-tcg-ai-battle", "deadline": "2020-01-01T00:00:00Z"}]}),
            encoding="utf-8",
        )
        manager = SimulationMonitorManager(
            kaggle_client=self.client,  # type: ignore[arg-type]
            harvest_root=self.root,
            default_competition="pokemon-tcg-ai-battle",
        )
        self.assertEqual(manager.snapshot().status.lifecycle, "ended")
        with self.assertRaisesRegex(ValueError, "赛事已结束"):
            asyncio.run(manager.run_now(trigger="manual"))

    def test_render_trajectory_chart_aligns_to_zero(self) -> None:
        from harvester.chart_renderer import render_trajectory_chart

        snapshot = {
            "status": {
                "agents": [
                    {
                        "submission_id": 55565346,
                        "description": "p46",
                        "score": 868.8,
                        "total_episodes": 559,
                        "rating_trajectory": [
                            {"game_number": 59, "score": 880.0},
                            {"game_number": 150, "score": 900.0},
                            {"game_number": 559, "score": 868.8},
                        ],
                    }
                ],
                "thresholds": {
                    "silver_cutoff_score": 911.0,
                    "bronze_cutoff_score": 841.2,
                },
            }
        }
        png_bytes = render_trajectory_chart(snapshot)
        self.assertTrue(png_bytes.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_wechat_chart_model_matches_current_web_chart_contract(self) -> None:
        from harvester.chart_renderer import build_trajectory_chart_model

        snapshot = {
            "config": {"competition": "kaggriculture"},
            "status": {
                "competition": "kaggriculture",
                "agents": [
                    {
                        "submission_id": 42,
                        "alias": "mer",
                        "total_episodes": 3,
                        "system_checks": 1,
                        "recent_episodes": [
                            {"id": 99, "is_system_check": True},
                        ],
                        "rating_trajectory": [
                            {"episode_id": 1, "game_number": 1, "score": 600.0},
                            {"episode_id": 99, "game_number": 19, "score": 9999.0},
                            {"episode_id": 2, "game_number": 20, "score": 880.0},
                        ],
                    }
                ],
                "thresholds": {
                    "gold_cutoff_score": 910.0,
                    "silver_cutoff_score": 850.0,
                    "bronze_cutoff_score": 800.0,
                },
            },
        }

        model = build_trajectory_chart_model(snapshot)

        self.assertEqual(model["title"], "kaggriculture — Rating Progression")
        self.assertEqual(model["series"][0]["x"], [1, 20])
        self.assertEqual(model["series"][0]["y"], [600.0, 880.0])
        self.assertEqual(model["series"][0]["total_games"], 2)
        self.assertEqual(model["cutoffs"]["gold"], 910.0)
        self.assertEqual(model["x_max"], 36)

    def test_custom_submission_aliases(self) -> None:
        manager = SimulationMonitorManager(
            kaggle_client=self.client,  # type: ignore[arg-type]
            harvest_root=self.root,
            default_competition="pokemon-tcg-ai-battle",
        )
        config = SimulationMonitorConfig(
            enabled=True,
            competition="pokemon-tcg-ai-battle",
            submission_aliases={
                "55565346": "p32_challenger",
                "55555162": "p46_final",
            },
        )
        _, agents, _, _, _, _ = manager._run_once_sync(config)
        self.assertEqual(len(agents), 2)
        self.assertEqual(agents[0].alias, "p32_challenger")
        self.assertEqual(agents[1].alias, "p46_final")

    def test_calculate_kaggle_medal_cutoff_ranks(self) -> None:
        from harvester.client.simulation import calculate_kaggle_medal_cutoff_ranks

        # 10208 teams (active large competition):
        # Gold: 10 + floor(10208 * 0.002) = 10 + 20 = 30
        # Silver: floor(10208 * 0.05) = 510
        # Bronze: floor(10208 * 0.10) = 1020
        gold, silver, bronze = calculate_kaggle_medal_cutoff_ranks(10208)
        self.assertEqual(gold, 30)
        self.assertEqual(silver, 510)
        self.assertEqual(bronze, 1020)

        # 1000 teams
        gold, silver, bronze = calculate_kaggle_medal_cutoff_ranks(1000)
        self.assertEqual(gold, 12)
        self.assertEqual(silver, 50)
        self.assertEqual(bronze, 100)

        # 500 teams (250-999 bracket: Top 10, Top 50, Top 100)
        gold, silver, bronze = calculate_kaggle_medal_cutoff_ranks(500)
        self.assertEqual(gold, 10)
        self.assertEqual(silver, 50)
        self.assertEqual(bronze, 100)

        # 200 teams (100-249 bracket: Top 10, Top 20%, Top 40%)
        gold, silver, bronze = calculate_kaggle_medal_cutoff_ranks(200)
        self.assertEqual(gold, 10)
        self.assertEqual(silver, 40)
        self.assertEqual(bronze, 80)

        # 80 teams (0-99 bracket: Top 10%, Top 20%, Top 40%)
        gold, silver, bronze = calculate_kaggle_medal_cutoff_ranks(80)
        self.assertEqual(gold, 8)
        self.assertEqual(silver, 16)
        self.assertEqual(bronze, 32)


if __name__ == "__main__":
    unittest.main()

