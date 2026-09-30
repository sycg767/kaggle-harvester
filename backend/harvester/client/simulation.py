"""
Simulation episode scraping, parsing, and leaderboard ranking algorithms.
"""

from __future__ import annotations

import csv
import io
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from harvester.client.parser import parse_public_score
from harvester.client.web import KaggleWebServiceClient
from harvester.models import (
    SimulationEpisode,
    SimulationEpisodeAgent,
    SimulationMedalThresholds,
)


def list_simulation_episodes_for_submission(
    submission_id: int,
    *,
    token: str,
    competition: str = "pokemon-tcg-ai-battle",
) -> list[SimulationEpisode]:
    """获取指定提交的完整对局历史（含当时真实天梯分、加减变动、对手及 Replay 链接）。"""
    sub_id = int(submission_id)

    # 1. 优先调用 Kaggle EpisodeService Web 接口获取当场真实初始分与结算变动
    try:
        web_client = KaggleWebServiceClient(token)
        try:
            data = web_client.post(
                "competitions.EpisodeService/ListEpisodes",
                {"submissionId": sub_id},
            )
        finally:
            web_client.close()
        raw_episodes = data.get("episodes", [])
        teams_map: dict[int, str] = {
            int(t["id"]): str(t.get("teamName") or t.get("name") or "")
            for t in data.get("teams", [])
            if isinstance(t, dict) and "id" in t
        }

        episodes: list[SimulationEpisode] = []
        for ep in raw_episodes:
            if not isinstance(ep, dict):
                continue
            ep_id = int(ep.get("id", 0))
            if not ep_id:
                continue
            create_time = ep.get("createTime")
            end_time = ep.get("endTime")
            raw_state = str(ep.get("state", "") or "")
            raw_type = str(ep.get("type", "") or "")

            raw_agents = ep.get("agents", []) or []
            agents: list[SimulationEpisodeAgent] = []
            my_agent: SimulationEpisodeAgent | None = None
            opponent_agent: SimulationEpisodeAgent | None = None
            my_delta: float | None = None
            opp_initial_score: float | None = None

            for i, a in enumerate(raw_agents):
                if not isinstance(a, dict):
                    continue
                agent_sub_id = int(a.get("submissionId", 0) or 0)
                team_id = a.get("teamId")
                team_id_int = int(team_id) if team_id is not None else None
                team_name = teams_map.get(team_id_int, "") if team_id_int else ""
                reward = a.get("reward")
                reward_val = float(reward) if reward is not None else None
                agent_index = int(a.get("index", i) or i)
                agent_state = str(a.get("state", "") or "")

                sim_agent = SimulationEpisodeAgent(
                    submission_id=agent_sub_id,
                    team_id=team_id_int,
                    team_name=team_name,
                    reward=reward_val,
                    index=agent_index,
                    state=agent_state,
                )
                agents.append(sim_agent)

                init_s = a.get("initialScore")
                upd_s = a.get("updatedScore")
                if agent_sub_id == sub_id:
                    my_agent = sim_agent
                    if init_s is not None and upd_s is not None:
                        my_delta = round(float(upd_s) - float(init_s), 1)
                else:
                    opponent_agent = sim_agent
                    if init_s is not None:
                        opp_initial_score = round(float(init_s), 1)

            my_idx = my_agent.index if my_agent is not None else 0
            my_team = my_agent.team_name if my_agent is not None else ""
            is_system_check = opponent_agent is None
            if is_system_check:
                opp_team = "系统自检"
                opp_team_id = None
                opp_sub_id = None
                rew = None
                outcome = "unknown"
                my_delta = None
            else:
                opp_team = opponent_agent.team_name or "对手"
                opp_team_id = opponent_agent.team_id
                opp_sub_id = opponent_agent.submission_id
                rew = my_agent.reward if my_agent is not None else None
                if rew is not None:
                    if rew > 0:
                        outcome = "win"
                    elif rew < 0:
                        outcome = "loss"
                    else:
                        outcome = "tie"
                else:
                    outcome = "unknown"

            replay_url = f"https://www.kaggle.com/competitions/{competition}/leaderboard?dialog=episodes-episode-{ep_id}"

            episodes.append(
                SimulationEpisode(
                    id=ep_id,
                    create_time=create_time,
                    end_time=end_time,
                    duration_seconds=None,
                    state=raw_state,
                    type=raw_type,
                    agents=agents,
                    my_agent_index=my_idx,
                    my_submission_id=sub_id,
                    my_team_name=my_team,
                    opponent_team_name=opp_team,
                    opponent_team_id=opp_team_id,
                    opponent_submission_id=opp_sub_id,
                    result=outcome,
                    is_system_check=is_system_check,
                    reward=rew,
                    score_delta=my_delta,
                    opponent_score=opp_initial_score,
                    replay_url=replay_url,
                )
            )

        episodes.sort(key=lambda x: x.create_time or "", reverse=True)
        return episodes
    except Exception:
        pass

    # 2. 回退到 Python SDK 接口
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi

        api = KaggleApi()
        api.authenticate()
        raw_episodes = api.competition_list_episodes(sub_id) or []

        episodes = []
        for ep in raw_episodes:
            if ep is None:
                continue
            ep_id = int(getattr(ep, "id", 0))
            if not ep_id:
                continue
            create_time_dt = getattr(ep, "create_time", None) or getattr(ep, "createTime", None)
            end_time_dt = getattr(ep, "end_time", None) or getattr(ep, "endTime", None)
            create_time = (
                create_time_dt.isoformat()
                if hasattr(create_time_dt, "isoformat")
                else (str(create_time_dt) if create_time_dt else None)
            )
            end_time = (
                end_time_dt.isoformat()
                if hasattr(end_time_dt, "isoformat")
                else (str(end_time_dt) if end_time_dt else None)
            )
            duration_seconds = None
            if hasattr(create_time_dt, "timestamp") and hasattr(end_time_dt, "timestamp"):
                duration_seconds = max(0.0, end_time_dt.timestamp() - create_time_dt.timestamp())

            raw_state = str(getattr(ep, "state", "") or "")
            raw_type = str(getattr(ep, "type", "") or "")

            raw_agents = getattr(ep, "agents", []) or []
            agents = []
            my_agent = None
            opponent_agent = None

            for i, a in enumerate(raw_agents):
                agent_sub_id = int(
                    getattr(a, "submission_id", None)
                    or getattr(a, "submissionId", 0)
                    or 0
                )
                team_id = getattr(a, "team_id", None) or getattr(a, "teamId", None)
                team_name = str(
                    getattr(a, "team_name", None)
                    or getattr(a, "teamName", "")
                    or ""
                )
                reward = getattr(a, "reward", None)
                reward_val = float(reward) if reward is not None else None
                agent_index = int(getattr(a, "index", i) or i)
                agent_state = str(getattr(a, "state", "") or "")

                sim_agent = SimulationEpisodeAgent(
                    submission_id=agent_sub_id,
                    team_id=int(team_id) if team_id is not None else None,
                    team_name=team_name,
                    reward=reward_val,
                    index=agent_index,
                    state=agent_state,
                )
                agents.append(sim_agent)
                if agent_sub_id == sub_id:
                    my_agent = sim_agent
                else:
                    opponent_agent = sim_agent

            my_idx = my_agent.index if my_agent is not None else 0
            my_team = my_agent.team_name if my_agent is not None else ""
            is_system_check = opponent_agent is None
            if is_system_check:
                opp_team = "系统自检"
                opp_team_id = None
                opp_sub_id = None
                rew = None
                outcome = "unknown"
            else:
                opp_team = opponent_agent.team_name or "对手"
                opp_team_id = opponent_agent.team_id
                opp_sub_id = opponent_agent.submission_id
                rew = my_agent.reward if my_agent is not None else None
                if rew is not None:
                    if rew > 0:
                        outcome = "win"
                    elif rew < 0:
                        outcome = "loss"
                    else:
                        outcome = "tie"
                else:
                    outcome = "unknown"

            replay_url = f"https://www.kaggle.com/competitions/{competition}/leaderboard?dialog=episodes-episode-{ep_id}"

            episodes.append(
                SimulationEpisode(
                    id=ep_id,
                    create_time=create_time,
                    end_time=end_time,
                    duration_seconds=duration_seconds,
                    state=raw_state,
                    type=raw_type,
                    agents=agents,
                    my_agent_index=my_idx,
                    my_submission_id=sub_id,
                    my_team_name=my_team,
                    opponent_team_name=opp_team,
                    opponent_team_id=opp_team_id,
                    opponent_submission_id=opp_sub_id,
                    result=outcome,
                    is_system_check=is_system_check,
                    reward=rew,
                    replay_url=replay_url,
                )
            )

        return sorted(episodes, key=lambda x: x.create_time or "", reverse=True)
    except Exception:
        return []


def calculate_kaggle_medal_cutoff_ranks(
    total_teams: int,
    bronze_percentile: float = 0.10,
) -> tuple[int, int, int]:
    """Calculate official Kaggle medal cutoff ranks based on team count.

    Official Kaggle Progression System brackets:
    - 0-99 teams: Gold Top 10%, Silver Top 20%, Bronze Top 40%
    - 100-249 teams: Gold Top 10, Silver Top 20%, Bronze Top 40%
    - 250-999 teams: Gold Top 10, Silver Top 50, Bronze Top 100
    - 1000+ teams: Gold Top 10 + 0.2%, Silver Top 5%, Bronze Top 10% (or custom bronze_percentile)

    Truncation strictly uses int(...) / floor because qualifying requires rank / total_teams <= percentile.
    """
    if total_teams <= 0:
        return 0, 0, 0

    if total_teams < 100:
        gold_rank = max(1, int(total_teams * 0.10))
        silver_rank = max(gold_rank, int(total_teams * 0.20))
        bronze_rank = max(silver_rank, int(total_teams * (bronze_percentile if bronze_percentile != 0.10 else 0.40)))
    elif total_teams < 250:
        gold_rank = min(10, total_teams)
        silver_rank = max(gold_rank, int(total_teams * 0.20))
        bronze_rank = max(silver_rank, int(total_teams * (bronze_percentile if bronze_percentile != 0.10 else 0.40)))
    elif total_teams < 1000:
        gold_rank = min(10, total_teams)
        silver_rank = min(50, total_teams)
        bronze_rank = max(silver_rank, int(total_teams * bronze_percentile)) if bronze_percentile != 0.10 else min(100, total_teams)
    else:
        gold_rank = min(total_teams, int(10 + total_teams * 0.002))
        silver_rank = max(gold_rank, int(total_teams * 0.05))
        bronze_rank = max(silver_rank, int(total_teams * bronze_percentile))

    return gold_rank, silver_rank, bronze_rank


def download_simulation_leaderboard_data(
    competition: str,
    bronze_percentile: float = 0.10,
) -> tuple[SimulationMedalThresholds, list[dict[str, Any]]]:
    """下载天梯全量榜单并计算奖牌线切分点。"""
    comp = competition.strip()
    rows: list[dict[str, Any]] = []
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi
        from kagglesdk.competitions.types.competition_api_service import ApiDownloadLeaderboardRequest

        api = KaggleApi()
        api.authenticate()
        with api.build_kaggle_client() as kaggle:
            req = ApiDownloadLeaderboardRequest()
            req.competition_name = comp
            resp = kaggle.competitions.competition_api_client.download_leaderboard(req)
            content = getattr(resp, "content", None)
            if content is None:
                content = resp.raw.read() if hasattr(resp, "raw") else bytes(resp)
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                for name in z.namelist():
                    if name.lower().endswith(".csv"):
                        with z.open(name) as f:
                            wrapper = io.TextIOWrapper(f, encoding="utf-8", errors="ignore")
                            reader = csv.DictReader(wrapper)
                            for r in reader:
                                cleaned_row: dict[str, Any] = {}
                                for k, v in r.items():
                                    norm_key = k.lstrip("\ufeff").strip() if k else ""
                                    cleaned_row[norm_key] = v
                                rows.append(cleaned_row)
                        break
    except Exception:
        from kaggle.api.kaggle_api_extended import KaggleApi

        api = KaggleApi()
        api.authenticate()
        with tempfile.TemporaryDirectory() as temp_dir:
            api.competition_leaderboard_download(comp, path=temp_dir)
            for item in Path(temp_dir).iterdir():
                if item.suffix.lower() == ".zip":
                    with zipfile.ZipFile(item) as z:
                        z.extractall(temp_dir)
            csv_path: Path | None = None
            for item in Path(temp_dir).iterdir():
                if item.suffix.lower() == ".csv":
                    csv_path = item
                    break

            if csv_path is None or not csv_path.exists():
                raise RuntimeError(f"未能下载竞赛 {comp} 的天梯排行榜。")

            with open(csv_path, "r", encoding="utf-8", errors="ignore") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    cleaned_row: dict[str, Any] = {}
                    for k, v in r.items():
                        norm_key = k.lstrip("\ufeff").strip() if k else ""
                        cleaned_row[norm_key] = v
                    rows.append(cleaned_row)

    total_teams = len(rows)
    if total_teams == 0:
        thresholds_empty = SimulationMedalThresholds(
            total_teams=0,
            bronze_percentile=bronze_percentile,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )
        return thresholds_empty, []

    gold_rank, silver_rank, bronze_rank = calculate_kaggle_medal_cutoff_ranks(
        total_teams,
        bronze_percentile=bronze_percentile,
    )

    def _get_score_at_rank(target_rank: int) -> float | None:
        if 1 <= target_rank <= len(rows):
            raw_score = rows[target_rank - 1].get("Score")
            return parse_public_score(raw_score)
        return None

    gold_score = _get_score_at_rank(gold_rank)
    silver_score = _get_score_at_rank(silver_rank)
    bronze_score = _get_score_at_rank(bronze_rank)

    thresholds = SimulationMedalThresholds(
        total_teams=total_teams,
        gold_cutoff_rank=gold_rank,
        gold_cutoff_score=gold_score,
        silver_cutoff_rank=silver_rank,
        silver_cutoff_score=silver_score,
        bronze_cutoff_rank=bronze_rank,
        bronze_cutoff_score=bronze_score,
        bronze_percentile=bronze_percentile,
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    return thresholds, rows
