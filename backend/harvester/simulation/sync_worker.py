from __future__ import annotations

import concurrent.futures
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from ..schemas import (
    CompetitionSubmission,
    SimulationAgentStats,
    SimulationEpisode,
    SimulationHistoryPoint,
    SimulationMedalThresholds,
    SimulationMonitorConfig,
    SimulationMonitorStatus,
)
from .agent_stats import calculate_agent_stats

if TYPE_CHECKING:
    from ..kaggle_client import KaggleClient


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def execute_simulation_sync(
    kaggle_client: KaggleClient,
    config: SimulationMonitorConfig,
    force_refresh: bool = False,
    service_started_at: str | None = None,
    prev_counts: dict[str, int] | None = None,
    prev_tiers: dict[str, str] | None = None,
    previous_agents: dict[int, SimulationAgentStats] | None = None,
    previous_thresholds: SimulationMedalThresholds | None = None,
    fetch_timeout_seconds: float = 45.0,
) -> tuple[
    SimulationMonitorStatus,
    list[SimulationAgentStats],
    SimulationMedalThresholds | None,
    int,
    list[SimulationHistoryPoint],
    list[dict[str, Any]],
]:
    from ..kaggle_client import _parse_public_score

    comp = config.competition.strip()
    errors: list[str] = []

    # 1. 确定配置的目标 Submission IDs (如 p46 / p31)
    target_ids_list = config.target_submission_ids or config.submission_ids
    target_sub_ids: list[int] = []
    if target_ids_list:
        for tid in target_ids_list:
            try:
                target_sub_ids.append(int(str(tid).strip()))
            except (ValueError, TypeError):
                continue

    submissions_map: dict[str, CompetitionSubmission] = {}
    thresholds: SimulationMedalThresholds | None = None
    leaderboard_rows: list[dict[str, Any]] = []
    episodes_map: dict[int, list[SimulationEpisode]] = {}
    fetch_failed_submission_ids: set[int] = set()

    def _fetch_submissions():
        try:
            raw_subs = kaggle_client.list_competition_submissions(
                competition=comp, page_size=50
            )
            for s in raw_subs:
                submissions_map[str(s.ref)] = s
        except Exception as exc:
            errors.append(f"拉取提交列表提示: {str(exc)[:150]}")

    def _fetch_leaderboard():
        nonlocal thresholds, leaderboard_rows
        try:
            thresholds, leaderboard_rows = kaggle_client.get_simulation_leaderboard(
                competition=comp,
                bronze_percentile=config.bronze_percentile,
                force_refresh=force_refresh,
            )
        except Exception as exc:
            errors.append(f"天梯榜单读取失败: {str(exc)[:200]}")

    def _fetch_sub_episodes(target_sub_id: int):
        try:
            episodes_map[target_sub_id] = kaggle_client.list_simulation_episodes(
                submission_id=target_sub_id, competition=comp
            )
        except Exception as exc:
            errors.append(f"提交 #{target_sub_id} 对局流水读取失败: {str(exc)[:200]}")
            episodes_map[target_sub_id] = []
            fetch_failed_submission_ids.add(target_sub_id)

    # 2. 全量并发拉取：将提交列表、天梯总榜、以及各目标 Agent 的对战流水在同一时刻并发触发
    worker_count = max(4, len(target_sub_ids) + 2)
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=worker_count)
    try:
        future_submission_ids: dict[concurrent.futures.Future, int] = {}
        futures: list[concurrent.futures.Future] = []

        futures.append(executor.submit(_fetch_submissions))
        futures.append(executor.submit(_fetch_leaderboard))

        if target_sub_ids:
            for sid in target_sub_ids:
                fut = executor.submit(_fetch_sub_episodes, sid)
                future_submission_ids[fut] = sid
                futures.append(fut)

        _, not_done = concurrent.futures.wait(
            futures,
            timeout=fetch_timeout_seconds,
        )
        if not_done:
            errors.append(
                f"部分天梯/对局数据拉取超时 ({int(fetch_timeout_seconds)}秒)"
            )
            for future in not_done:
                submission_id = future_submission_ids.get(future)
                if submission_id is not None:
                    fetch_failed_submission_ids.add(submission_id)
                future.cancel()
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    # 如果没有预设 target_ids_list，则使用从 submissions 中自动提取的活跃 Agent
    if not target_sub_ids:
        discovered_subs: list[CompetitionSubmission] = []
        for s in submissions_map.values():
            norm_status = (s.status or "").lower()
            if "error" not in norm_status and "fail" not in norm_status:
                discovered_subs.append(s)
                if len(discovered_subs) >= 2:
                    break
        if not discovered_subs and submissions_map:
            discovered_subs = list(submissions_map.values())[:2]

        if discovered_subs:
            target_sub_ids = [int(str(s.ref)) for s in discovered_subs]
            sub_executor = concurrent.futures.ThreadPoolExecutor(
                max_workers=len(target_sub_ids)
            )
            try:
                sub_futs = [
                    sub_executor.submit(_fetch_sub_episodes, sid)
                    for sid in target_sub_ids
                ]
                concurrent.futures.wait(
                    sub_futs, timeout=fetch_timeout_seconds
                )
            finally:
                sub_executor.shutdown(wait=False, cancel_futures=True)

    # 3. 构造 target_submissions 列表
    target_submissions: list[CompetitionSubmission] = []
    if target_sub_ids:
        for sid in target_sub_ids:
            sid_str = str(sid)
            if sid_str in submissions_map:
                target_submissions.append(submissions_map[sid_str])
            else:
                desc = (
                    "p46"
                    if sid_str == "55565346"
                    else ("p31" if sid_str == "55555162" else f"Agent #{sid_str}")
                )
                public_score = (
                    843.0
                    if sid_str == "55565346"
                    else (847.8 if sid_str == "55555162" else None)
                )
                target_submissions.append(
                    CompetitionSubmission(
                        ref=sid_str,
                        description=desc,
                        file_name=f"{desc}_submission.tar.gz",
                        public_score=public_score,
                        status="complete",
                    )
                )
    if not target_submissions:
        target_submissions = [
            CompetitionSubmission(
                ref="55565346",
                description="p46",
                file_name="p46_submission.tar.gz",
                public_score=843.0,
                status="complete",
            ),
            CompetitionSubmission(
                ref="55555162",
                description="p31",
                file_name="p3plus31_submission.tar.gz",
                public_score=847.8,
                status="complete",
            ),
        ]

    # 构建 team_id/team_name 到 rank/score 的索引
    team_ranks: dict[str, int] = {}
    team_scores: dict[str, float] = {}
    for idx, row in enumerate(leaderboard_rows):
        rank_val = idx + 1
        t_id = str(row.get("TeamId") or "").strip()
        t_name = str(row.get("TeamName") or "").strip().lower()
        row_score = _parse_public_score(row.get("Score"))
        if t_id:
            team_ranks[t_id] = rank_val
            if row_score is not None:
                team_scores[t_id] = row_score
        if t_name:
            team_ranks[t_name] = rank_val
            if row_score is not None:
                team_scores[t_name] = row_score

    # 3. 统计战绩并匹配天梯名次
    agents_stats: list[SimulationAgentStats] = []
    new_episodes_total = 0
    new_history_points: list[SimulationHistoryPoint] = []
    events_to_notify: list[dict[str, Any]] = []
    checked_time = utc_now().isoformat()

    counts = prev_counts or {}
    tiers = prev_tiers or {}
    prev_agents_map = previous_agents or {}

    for sub in target_submissions:
        sub_id = int(str(sub.ref))
        episodes: list[SimulationEpisode] = episodes_map.get(sub_id, [])
        stale_agent = prev_agents_map.get(sub_id)
        if sub_id in fetch_failed_submission_ids and stale_agent is not None:
            agents_stats.append(stale_agent)
            new_history_points.append(
                SimulationHistoryPoint(
                    timestamp=checked_time,
                    submission_id=stale_agent.submission_id,
                    score=stale_agent.score,
                    rank=stale_agent.rank,
                    total_episodes=stale_agent.total_episodes,
                    wins=stale_agent.wins,
                    losses=stale_agent.losses,
                    ties=stale_agent.ties,
                    win_rate=stale_agent.win_rate,
                    bronze_gap_score=stale_agent.bronze_gap_score,
                    bronze_cutoff_score=(
                        previous_thresholds.bronze_cutoff_score
                        if previous_thresholds
                        else None
                    ),
                )
            )
            continue

        agent_stat, history_point = calculate_agent_stats(
            sub=sub,
            episodes=episodes,
            comp=comp,
            leaderboard_rows=leaderboard_rows,
            team_ranks=team_ranks,
            team_scores=team_scores,
            thresholds=thresholds,
            config=config,
            checked_time=checked_time,
        )
        agents_stats.append(agent_stat)
        new_history_points.append(history_point)

        agent_alias = agent_stat.alias
        score = agent_stat.score
        rank = agent_stat.rank
        total = agent_stat.total_episodes
        wins = agent_stat.wins
        losses = agent_stat.losses
        win_rate = agent_stat.win_rate
        bronze_gap_score = agent_stat.bronze_gap_score
        medal_tier = agent_stat.medal_tier

        # 对比增量对局与通知
        # Include the competition in persistent counters so a reused submission
        # number from another competition cannot create a false delta/medal event.
        state_key = f"{comp}:{sub_id}"
        prev_cnt = counts.get(state_key)
        prev_tier = tiers.get(state_key)
        if prev_cnt is not None and total > prev_cnt:
            new_cnt = total - prev_cnt
            new_episodes_total += new_cnt
            if config.notify_on_new_matches:
                latest_ep = episodes[0] if episodes else None
                events_to_notify.append({
                    "type": "new_episodes",
                    "submission_id": sub_id,
                    "alias": agent_alias,
                    "description": sub.description,
                    "new_matches": new_cnt,
                    "total_matches": total,
                    "wins": wins,
                    "losses": losses,
                    "win_rate": win_rate,
                    "public_score": score,
                    "rank": rank,
                    "bronze_gap_score": bronze_gap_score,
                    "opponent_name": (
                        latest_ep.opponent_team_name if latest_ep else None
                    ),
                    "opponent_score": (
                        latest_ep.opponent_score if latest_ep else None
                    ),
                    "result": latest_ep.result if latest_ep else None,
                    "score_delta": latest_ep.score_delta if latest_ep else None,
                })

        if (
            prev_tier is not None
            and prev_tier != medal_tier
            and medal_tier != "unknown"
        ):
            if config.notify_on_medal_change:
                events_to_notify.append({
                    "type": "medal_change",
                    "submission_id": sub_id,
                    "alias": agent_alias,
                    "description": sub.description,
                    "previous_medal": prev_tier,
                    "current_medal": medal_tier,
                    "rank": rank,
                    "public_score": score,
                    "bronze_gap_score": bronze_gap_score,
                })

    total_tracked = sum(a.total_episodes for a in agents_stats)
    status = SimulationMonitorStatus(
        running=False,
        scheduler_alive=True,
        service_started_at=service_started_at,
        scheduler_heartbeat_at=checked_time,
        last_checked_at=checked_time,
        next_run_at=(
            utc_now() + timedelta(minutes=config.interval_minutes)
        ).isoformat(),
        last_error="；".join(errors) if errors else None,
        competition=comp,
        agents=agents_stats,
        thresholds=thresholds,
        medal_thresholds=thresholds,
        history=list(new_history_points),
        history_points=list(new_history_points),
        total_tracked_episodes=total_tracked,
        new_episodes_this_run=new_episodes_total,
        new_episodes_count=new_episodes_total,
    )
    return (
        status,
        agents_stats,
        thresholds,
        new_episodes_total,
        new_history_points,
        events_to_notify,
    )
