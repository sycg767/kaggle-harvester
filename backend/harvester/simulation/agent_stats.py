from __future__ import annotations

import re
from typing import Any, Literal

from ..kaggle_client import _parse_public_score
from ..models import (
    CompetitionSubmission,
    SimulationAgentStats,
    SimulationEpisode,
    SimulationHistoryPoint,
    SimulationMedalThresholds,
    SimulationMonitorConfig,
    SimulationRatingPoint,
)


def clean_system_check_episodes(episodes: list[SimulationEpisode]) -> None:
    system_check_names = {"对手", "系统自检"}
    for ep in episodes:
        if (
            ep.is_system_check
            or (
                ep.opponent_submission_id is None
                and ep.opponent_team_id is None
                and ep.opponent_team_name.strip() in system_check_names
            )
        ):
            ep.is_system_check = True
            ep.opponent_team_name = "系统自检"
            ep.result = "unknown"
            ep.reward = None
            ep.score_delta = None
            ep.opponent_score = None
        else:
            # 重新矫正非系统自检对局的胜负平属性（纠正旧版本或缓存数据）
            my_agent = next(
                (a for a in ep.agents if a.submission_id == ep.my_submission_id),
                None,
            )
            opponents = [a for a in ep.agents if a.submission_id != ep.my_submission_id]
            if my_agent and opponents:
                my_rew = my_agent.reward
                opp_rewards = [a.reward for a in opponents if a.reward is not None]
                if my_rew is not None and opp_rewards:
                    opp_max = max(opp_rewards)
                    if my_rew > opp_max:
                        ep.result = "win"
                    elif my_rew < opp_max:
                        ep.result = "loss"
                    else:
                        ep.result = "tie"
                elif ep.score_delta is not None:
                    if ep.score_delta > 0:
                        ep.result = "win"
                    elif ep.score_delta < 0:
                        ep.result = "loss"
                    else:
                        ep.result = "tie"
            elif ep.score_delta is not None:
                if ep.score_delta > 0:
                    ep.result = "win"
                elif ep.score_delta < 0:
                    ep.result = "loss"
                else:
                    ep.result = "tie"


def resolve_agent_alias(
    sub_id: int,
    sub: CompetitionSubmission,
    submission_aliases: dict[str, str] | None = None,
) -> str | None:
    sub_id_str = str(sub_id)
    if submission_aliases and isinstance(submission_aliases, dict):
        alias = submission_aliases.get(sub_id_str) or submission_aliases.get(sub_id)  # type: ignore[arg-type]
        if alias:
            return alias
    if sub_id == 55565346:
        return "p46"
    if sub_id == 55555162:
        return "p31"
    raw_desc = (sub.description or sub.file_name or "").strip()
    m = re.search(r"\b(p\d+(?:plus\d+)?)\b", raw_desc, re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def build_rating_trajectory(
    real_episodes: list[SimulationEpisode],
    score: float | None,
) -> list[SimulationRatingPoint]:
    if score is None:
        return []
    chronological_episodes = sorted(
        real_episodes,
        key=lambda item: (item.end_time or item.create_time or "", item.id),
    )
    score_after = float(score)
    reversed_points: list[SimulationRatingPoint] = []
    for game_number, ep in reversed(list(enumerate(chronological_episodes, start=1))):
        reversed_points.append(
            SimulationRatingPoint(
                episode_id=ep.id,
                game_number=game_number,
                timestamp=ep.end_time or ep.create_time,
                score=round(score_after, 1),
                score_delta=ep.score_delta,
                result=ep.result,
            )
        )
        score_after = round(score_after - (ep.score_delta or 0.0), 1)
    return list(reversed(reversed_points))


def calculate_agent_stats(
    sub: CompetitionSubmission,
    episodes: list[SimulationEpisode],
    comp: str,
    leaderboard_rows: list[dict[str, Any]],
    team_ranks: dict[str, int],
    team_scores: dict[str, float],
    thresholds: SimulationMedalThresholds | None,
    config: SimulationMonitorConfig,
    checked_time: str,
) -> tuple[SimulationAgentStats, SimulationHistoryPoint]:
    sub_id = int(str(sub.ref))
    clean_system_check_episodes(episodes)

    real_episodes = [ep for ep in episodes if not ep.is_system_check]
    wins = sum(1 for ep in real_episodes if ep.result == "win")
    losses = sum(1 for ep in real_episodes if ep.result == "loss")
    ties = sum(1 for ep in real_episodes if ep.result == "tie")
    system_checks = sum(1 for ep in episodes if ep.is_system_check)
    total = len(episodes)
    win_rate = round((wins / len(real_episodes) * 100), 1) if real_episodes else 0.0

    my_team_name = sub.team_name or ""
    if not my_team_name and episodes:
        my_team_name = episodes[0].my_team_name or ""
    if not my_team_name and comp == "pokemon-tcg-ai-battle":
        my_team_name = "GrimmsnaRL"

    score = sub.public_score
    if score is None:
        if comp == "pokemon-tcg-ai-battle":
            if sub_id == 55565346:
                score = 843.0
            elif sub_id == 55555162:
                score = 847.8
        if score is None and my_team_name and my_team_name.strip().lower() in team_scores:
            score = team_scores[my_team_name.strip().lower()]

    rank: int | None = None
    if score is not None and leaderboard_rows:
        for idx, row in enumerate(leaderboard_rows):
            r_score = _parse_public_score(row.get("Score"))
            if r_score is not None and score >= r_score:
                rank = idx + 1
                break
    if rank is None and my_team_name:
        rank = team_ranks.get(my_team_name.strip().lower())

    bronze_cutoff = thresholds.bronze_cutoff_score if thresholds else None
    silver_cutoff = thresholds.silver_cutoff_score if thresholds else None
    gold_cutoff = thresholds.gold_cutoff_score if thresholds else None
    bronze_rank = thresholds.bronze_cutoff_rank if thresholds else None
    silver_rank = thresholds.silver_cutoff_rank if thresholds else None
    gold_rank = thresholds.gold_cutoff_rank if thresholds else None
    bronze_gap_score: float | None = None
    if score is not None and bronze_cutoff is not None:
        bronze_gap_score = round(score - bronze_cutoff, 1)

    bronze_gap_rank: int | None = None
    if rank is not None and bronze_rank is not None:
        bronze_gap_rank = bronze_rank - rank

    medal_tier: Literal["gold", "silver", "bronze", "none", "unknown"] = "unknown"
    if rank is not None:
        if gold_rank and rank <= gold_rank:
            medal_tier = "gold"
        elif silver_rank and rank <= silver_rank:
            medal_tier = "silver"
        elif bronze_rank and rank <= bronze_rank:
            medal_tier = "bronze"
        else:
            medal_tier = "none"
    elif score is not None and bronze_cutoff is not None:
        if gold_cutoff and score >= gold_cutoff:
            medal_tier = "gold"
        elif silver_cutoff and score >= silver_cutoff:
            medal_tier = "silver"
        elif score >= bronze_cutoff:
            medal_tier = "bronze"
        else:
            medal_tier = "none"

    tier_cushion_score: float | None = None
    next_tier_gap_score: float | None = None
    next_tier_name: Literal["gold", "silver", "bronze"] | None = None

    if score is not None:
        if medal_tier == "gold":
            if gold_cutoff is not None:
                tier_cushion_score = round(score - gold_cutoff, 1)
            next_tier_gap_score = None
            next_tier_name = None
        elif medal_tier == "silver":
            if silver_cutoff is not None:
                tier_cushion_score = round(score - silver_cutoff, 1)
            if gold_cutoff is not None:
                next_tier_gap_score = round(gold_cutoff - score, 1)
            next_tier_name = "gold"
        elif medal_tier == "bronze":
            if bronze_cutoff is not None:
                tier_cushion_score = round(score - bronze_cutoff, 1)
            if silver_cutoff is not None:
                next_tier_gap_score = round(silver_cutoff - score, 1)
            next_tier_name = "silver"
        else:
            tier_cushion_score = None
            if bronze_cutoff is not None:
                next_tier_gap_score = round(bronze_cutoff - score, 1)
            next_tier_name = "bronze"

    for ep in real_episodes:
        if ep.opponent_score is None:
            opp_key = ep.opponent_team_name.strip().lower() if ep.opponent_team_name else ""
            opp_score = team_scores.get(opp_key) if opp_key else None
            if opp_score is None and ep.opponent_team_id:
                opp_score = team_scores.get(str(ep.opponent_team_id))
            ep.opponent_score = opp_score

    rating_trajectory = build_rating_trajectory(real_episodes, score)
    agent_alias = resolve_agent_alias(sub_id, sub, config.submission_aliases)

    agent_stat = SimulationAgentStats(
        submission_id=sub_id,
        alias=agent_alias,
        file_name=sub.file_name,
        description=sub.description,
        team_name=my_team_name,
        date=sub.date,
        status=sub.status,
        public_score=score,
        score=score,
        public_score_display=sub.public_score_display or (f"{score:.1f}" if score is not None else None),
        rank=rank,
        total_episodes=total,
        wins=wins,
        losses=losses,
        ties=ties,
        system_checks=system_checks,
        win_rate=win_rate,
        recent_episodes=episodes[:50],
        rating_trajectory=rating_trajectory,
        bronze_gap_score=bronze_gap_score,
        bronze_gap_rank=bronze_gap_rank,
        tier_cushion_score=tier_cushion_score,
        next_tier_gap_score=next_tier_gap_score,
        next_tier_name=next_tier_name,
        medal_tier=medal_tier,
        last_updated=checked_time,
    )

    history_point = SimulationHistoryPoint(
        timestamp=checked_time,
        submission_id=sub_id,
        alias=agent_alias,
        score=score,
        rank=rank,
        total_episodes=total,
        wins=wins,
        losses=losses,
        ties=ties,
        system_checks=system_checks,
        win_rate=win_rate,
        bronze_gap_score=bronze_gap_score,
        bronze_cutoff_score=bronze_cutoff,
    )

    return agent_stat, history_point
