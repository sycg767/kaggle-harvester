from __future__ import annotations

import asyncio
import concurrent.futures
import json
import os
import re
import socket
import threading
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from string import hexdigits
from typing import Any, Literal

from .cache import PersistentSimulationEpisodeStore
from .kaggle_client import KaggleClient, _parse_public_score
from .notifications import NotificationManager
from .models import (
    CompetitionSubmission,
    SimulationAgentStats,
    SimulationClawbotStatus,
    SimulationClawbotTestCandidate,
    SimulationClawbotTestResult,
    SimulationEpisode,
    SimulationHistoryPoint,
    SimulationMedalThresholds,
    SimulationMonitorConfig,
    SimulationEpisodePageResponse,
    SimulationRatingPoint,
    SimulationMonitorRunDetail,
    SimulationMonitorRunLog,
    SimulationMonitorSnapshot,
    SimulationMonitorStatus,
)
from .simulation import (
    ClawbotService,
    calculate_agent_stats,
    execute_simulation_sync,
)


SIMULATION_FETCH_TIMEOUT_SECONDS = float(
    os.environ.get("SIMULATION_FETCH_TIMEOUT_SECONDS", "45")
)
SIMULATION_CHECK_TIMEOUT_SECONDS = max(
    SIMULATION_FETCH_TIMEOUT_SECONDS + 15.0,
    float(os.environ.get("SIMULATION_CHECK_TIMEOUT_SECONDS", "60")),
)


class SimulationMonitorBusyError(RuntimeError):
    """已有一次对战监控检查正在运行中。"""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


class SimulationMonitorManager:
    """轮询 Kaggle 模拟对抗类竞赛对战流水、战绩、天梯排名及铜牌线。"""

    MAX_RUN_LOGS = 200
    MAX_HISTORY_POINTS = 500

    def __init__(
        self,
        kaggle_client: KaggleClient,
        harvest_root: str | Path,
        default_competition: str = "pokemon-tcg-ai-battle",
        notification_manager: NotificationManager | None = None,
        episode_store: PersistentSimulationEpisodeStore | None = None,
    ) -> None:
        self._kaggle = kaggle_client
        self._notifications = notification_manager
        self._episode_store = episode_store or PersistentSimulationEpisodeStore(harvest_root)
        if getattr(self._kaggle, "_episode_store", None) is None:
            self._kaggle._episode_store = self._episode_store
        self._state_path = (
            Path(harvest_root).resolve() / "_cache" / "simulation_monitor.json"
        )
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._run_details_root = self._state_path.parent / "simulation_monitor_runs"
        self._run_details_root.mkdir(parents=True, exist_ok=True)
        self._state_lock = threading.RLock()
        self._sync_run_lock = threading.Lock()
        self._run_lock = asyncio.Lock()
        self._wake_event = asyncio.Event()
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._service_started_at = _utc_now().isoformat()
        self._config = SimulationMonitorConfig(competition=default_competition)
        self._status = SimulationMonitorStatus(
            competition=default_competition,
            service_started_at=self._service_started_at,
            scheduler_heartbeat_at=self._service_started_at,
        )
        # key: f"{submission_id}" -> previous known episode count
        self._known_episode_counts: dict[str, int] = {}
        # key: f"{submission_id}" -> previous medal tier
        self._known_medal_tiers: dict[str, str] = {}
        self._history_points: list[SimulationHistoryPoint] = []
        self._logs: list[SimulationMonitorRunLog] = []
        self._load_state()

    def _load_state(self) -> None:
        if not self._state_path.exists():
            return
        try:
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
            was_running = bool(data.get("status", {}).get("running", False))
            self._config = SimulationMonitorConfig(**data.get("config", {}))
            self._status = SimulationMonitorStatus(**data.get("status", {}))
            self._status.enabled = bool(self._config.enabled)
            self._status.running = False
            self._status.scheduler_alive = False
            self._status.service_started_at = self._service_started_at
            self._status.scheduler_heartbeat_at = self._service_started_at
            if self._status.last_error and "CompetitionSubmission" in self._status.last_error:
                self._status.last_error = None
            if was_running or (data.get("status", {}).get("last_error") and "CompetitionSubmission" in str(data.get("status", {}).get("last_error"))):
                self._save_state()
            self._known_episode_counts = {
                str(k): int(v)
                for k, v in data.get("known_episode_counts", {}).items()
            }
            self._known_medal_tiers = {
                str(k): str(v)
                for k, v in data.get("known_medal_tiers", {}).items()
            }
            raw_history = data.get("history_points", [])
            if isinstance(raw_history, list):
                self._history_points = [
                    SimulationHistoryPoint(**item)
                    for item in raw_history[-self.MAX_HISTORY_POINTS :]
                    if isinstance(item, dict)
                ]
            self._status.history_points = list(self._history_points)
            logs = data.get("logs", [])
            if isinstance(logs, list):
                for item in logs[: self.MAX_RUN_LOGS]:
                    try:
                        self._logs.append(SimulationMonitorRunLog(**item))
                    except (TypeError, ValueError):
                        continue
        except (json.JSONDecodeError, OSError, ValueError, TypeError):
            self._config.enabled = False
            self._status = SimulationMonitorStatus(
                competition=self._config.competition,
                last_error="Simulation 监控配置无法读取，已重置为默认配置。",
                service_started_at=self._service_started_at,
                scheduler_heartbeat_at=self._service_started_at,
            )

    def _save_state(self) -> None:
        with self._state_lock:
            payload = {
                "version": 1,
                "updated_at": _utc_now().isoformat(),
                "config": self._config.model_dump(),
                "status": self._status.model_dump(),
                "known_episode_counts": self._known_episode_counts,
                "known_medal_tiers": self._known_medal_tiers,
                "history_points": [item.model_dump() for item in self._history_points],
                "logs": [item.model_dump() for item in self._logs],
            }
            temp_path = self._state_path.with_suffix(".tmp")
            temp_path.write_text(
                json.dumps(payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            temp_path.replace(self._state_path)

    @classmethod
    def _get_clawbot_status(cls, force: bool = False) -> SimulationClawbotStatus:
        return ClawbotService.get_status(force=force)

    @classmethod
    def test_clawbot(cls) -> SimulationClawbotTestResult:
        return ClawbotService.test_gateway()

    def health_status(self) -> dict[str, Any]:
        """Return dashboard aggregates without copying histories or probing gateways."""
        with self._state_lock:
            status = self._status.model_dump(exclude={
                "history": True,
                "history_points": True,
                "agents": {"__all__": {"recent_episodes", "rating_trajectory"}},
            })
            status["history"] = []
            status["history_points"] = []
            for agent in status["agents"]:
                agent["recent_episodes"] = []
                agent["rating_trajectory"] = []
            status["running"] = bool(status["running"] and self._run_lock.locked())
            status["scheduler_alive"] = bool(self._task is not None and not self._task.done())
            status["enabled"] = bool(self._config.enabled)
            return status

    def snapshot(self) -> SimulationMonitorSnapshot:
        with self._state_lock:
            status = self._status.model_copy(deep=True)
            if not self._run_lock.locked():
                status.running = False
            status.scheduler_alive = bool(
                self._task is not None and not self._task.done()
            )
            status.enabled = bool(self._config.enabled)
            status.history_points = [item.model_copy(deep=True) for item in self._history_points]
            status.clawbot = self._get_clawbot_status()
            return SimulationMonitorSnapshot(
                config=self._config.model_copy(deep=True),
                status=status,
                logs=[item.model_copy(deep=True) for item in self._logs],
            )

    def get_episodes_page(
        self,
        submission_id: int,
        offset: int = 0,
        limit: int = 50,
    ) -> SimulationEpisodePageResponse:
        """按分页返回指定提交的对局流水。

        优先从监控轮询维护的内存缓存读取；服务刚重启且缓存为空时，才按需拉取一次完整历史。
        分页切片在本地完成，不会为每次翻页重复请求 Kaggle。
        """
        offset = max(0, int(offset))
        limit = max(1, min(int(limit), 200))
        episodes = self._kaggle.get_simulation_episodes_cached(submission_id)
        if not episodes:
            episodes = self._kaggle.list_simulation_episodes(
                submission_id=submission_id,
                competition=self._config.competition,
            )
        total = len(episodes)
        page = episodes[offset : offset + limit]
        return SimulationEpisodePageResponse(
            submission_id=submission_id,
            total=total,
            offset=offset,
            limit=limit,
            episodes=[item.model_copy(deep=True) for item in page],
        )

    def _run_detail_path(self, log_id: str) -> Path:
        if len(log_id) != 32 or any(char not in hexdigits for char in log_id):
            raise ValueError("运行日志 ID 无效。")
        return self._run_details_root / f"{log_id.lower()}.json"

    def _save_run_detail(
        self,
        log: SimulationMonitorRunLog,
        agents: list[SimulationAgentStats],
        thresholds: SimulationMedalThresholds | None,
    ) -> None:
        path = self._run_detail_path(log.id)
        temp_path = path.with_suffix(".tmp")
        payload = SimulationMonitorRunDetail(
            log=log,
            agents=agents,
            medal_thresholds=thresholds,
        )
        temp_path.write_text(
            json.dumps(payload.model_dump(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        temp_path.replace(path)

    def get_run_detail(self, log_id: str) -> SimulationMonitorRunDetail | None:
        with self._state_lock:
            log = next((item for item in self._logs if item.id == log_id), None)
            if log is None:
                return None
            log_copy = log.model_copy(deep=True)
        detail_path = self._run_detail_path(log_id)
        if not detail_path.exists():
            return SimulationMonitorRunDetail(log=log_copy, agents=[])
        try:
            data = json.loads(detail_path.read_text(encoding="utf-8"))
            detail = SimulationMonitorRunDetail(**data)
            return detail
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            return SimulationMonitorRunDetail(log=log_copy, agents=[])

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._status.scheduler_alive = True
        self._status.service_started_at = self._service_started_at
        self._status.scheduler_heartbeat_at = _utc_now().isoformat()
        if self._config.enabled:
            next_run = _parse_datetime(self._status.next_run_at)
            if next_run is None:
                self._status.next_run_at = _utc_now().isoformat()
                self._save_state()
        self._task = asyncio.create_task(
            self._scheduler_loop(), name="kaggle-simulation-monitor"
        )

    async def stop(self) -> None:
        self._stop_event.set()
        self._wake_event.set()
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
        with self._state_lock:
            self._status.scheduler_alive = False

    async def update_config(
        self, config: SimulationMonitorConfig
    ) -> SimulationMonitorSnapshot:
        with self._state_lock:
            comp_changed = (self._config.competition != config.competition)
            self._config = config.model_copy(deep=True)
            self._status.enabled = bool(config.enabled)
            self._status.competition = config.competition
            if comp_changed:
                self._status.agents = []
                self._status.thresholds = None
                self._status.medal_thresholds = None
                self._history_points = []
                self._status.history = []
                self._status.history_points = []
                self._status.total_tracked_episodes = 0
                self._status.new_episodes_this_run = 0
                self._known_episode_counts.clear()
                self._known_medal_tiers.clear()
                self._status.last_checked_at = None
            self._status.next_run_at = (
                (_utc_now() + timedelta(minutes=config.interval_minutes)).isoformat()
                if config.enabled
                else None
            )
            if self._status.agents and config.submission_aliases:
                for agent in self._status.agents:
                    sub_str = str(agent.submission_id)
                    if sub_str in config.submission_aliases:
                        agent.alias = config.submission_aliases[sub_str] or None
                    elif agent.submission_id in config.submission_aliases:
                        agent.alias = config.submission_aliases[agent.submission_id] or None
            self._save_state()
        self._wake_event.set()
        return self.snapshot()

    async def run_now(
        self, trigger: Literal["scheduled", "manual"] = "manual"
    ) -> SimulationMonitorSnapshot:
        if self._run_lock.locked():
            raise SimulationMonitorBusyError("Simulation 对战检查正在运行中，请稍候。")

        async with self._run_lock:
            started_at = _utc_now()
            with self._state_lock:
                previous_status = self._status.model_copy(deep=True)
                self._status.running = True
                self._status.last_error = None
                self._status.next_run_at = None
                self._save_state()
                config = self._config.model_copy(deep=True)

            status: SimulationMonitorStatus | None = None
            agents: list[SimulationAgentStats] = []
            thresholds: SimulationMedalThresholds | None = None
            new_episodes_total = 0
            new_history_points: list[SimulationHistoryPoint] = []
            events_to_notify: list[dict[str, Any]] = []

            force_refresh = (trigger == "manual")
            try:
                try:
                    (
                        status,
                        agents,
                        thresholds,
                        new_episodes_total,
                        new_history_points,
                        events_to_notify,
                    ) = await asyncio.wait_for(
                        asyncio.to_thread(self._run_once_sync, config, force_refresh),
                        timeout=SIMULATION_CHECK_TIMEOUT_SECONDS,
                    )
                except asyncio.TimeoutError:
                    status = previous_status
                    status.last_checked_at = _utc_now().isoformat()
                    status.last_error = (
                        f"Kaggle 网络请求超时 ({int(SIMULATION_CHECK_TIMEOUT_SECONDS)}秒)，"
                        "本次检查已安全中止，已保留上次成功数据。"
                    )
                except Exception as exc:
                    status = previous_status
                    status.last_checked_at = _utc_now().isoformat()
                    status.last_error = str(exc)[:500]

                with self._state_lock:
                    finished_at = _utc_now()
                    status.running = False
                    status.scheduler_alive = True
                    status.service_started_at = self._service_started_at
                    status.scheduler_heartbeat_at = _utc_now().isoformat()
                    status.next_run_at = (
                        (
                            _utc_now()
                            + timedelta(minutes=self._config.interval_minutes)
                        ).isoformat()
                        if self._config.enabled
                        else None
                    )
                    if new_history_points:
                        self._history_points.extend(new_history_points)
                        self._history_points = self._history_points[-self.MAX_HISTORY_POINTS :]
                    status.history = list(self._history_points)
                    status.history_points = list(self._history_points)
                    self._status = status

                    for agent in agents:
                        self._known_episode_counts[str(agent.submission_id)] = agent.total_episodes
                        self._known_medal_tiers[str(agent.submission_id)] = agent.medal_tier

                    outcome: Literal["success", "partial", "failed"] = (
                        "failed"
                        if not agents and status.last_error
                        else "partial"
                        if status.last_error
                        else "success"
                    )

                    agents_summary = [
                        {
                            "submission_id": a.submission_id,
                            "alias": a.alias,
                            "description": a.description,
                            "public_score": a.public_score,
                            "score": a.score,
                            "rank": a.rank,
                            "wins": a.wins,
                            "losses": a.losses,
                            "ties": a.ties,
                            "win_rate": a.win_rate,
                            "bronze_gap_score": a.bronze_gap_score,
                            "tier_cushion_score": a.tier_cushion_score,
                            "next_tier_gap_score": a.next_tier_gap_score,
                            "next_tier_name": a.next_tier_name,
                            "medal_tier": a.medal_tier,
                        }
                        for a in agents
                    ]

                    log = SimulationMonitorRunLog(
                        id=uuid.uuid4().hex,
                        trigger=trigger,
                        outcome=outcome,
                        started_at=started_at.isoformat(),
                        finished_at=finished_at.isoformat(),
                        duration_seconds=round(
                            (finished_at - started_at).total_seconds(), 3
                        ),
                        competition=config.competition,
                        agent_count=len(agents),
                        total_episodes_found=status.total_tracked_episodes,
                        new_episodes_found=new_episodes_total,
                        total_teams=thresholds.total_teams if thresholds else 0,
                        bronze_cutoff_score=thresholds.bronze_cutoff_score if thresholds else None,
                        agents_summary=agents_summary,
                        new_episodes_count=new_episodes_total,
                        error=status.last_error,
                        details_available=bool(agents),
                    )
                    if agents:
                        try:
                            self._save_run_detail(log, agents, thresholds)
                        except (OSError, ValueError, TypeError):
                            log.details_available = False
                    self._logs.insert(0, log)
                    self._logs = self._logs[: self.MAX_RUN_LOGS]
                    self._save_state()

                # Enqueue notifications if any
                if self._notifications is not None and events_to_notify:
                    try:
                        self._notifications.enqueue_simulation_events(
                            competition=config.competition,
                            events=events_to_notify,
                            checked_at=status.last_checked_at,
                        )
                    except Exception:
                        pass

            finally:
                with self._state_lock:
                    self._status.running = False
                    self._save_state()

            self._wake_event.set()
            return self.snapshot()

    def _run_once_sync(self, config: SimulationMonitorConfig, force_refresh: bool = False):
        if not self._sync_run_lock.acquire(blocking=False):
            raise SimulationMonitorBusyError("上一轮 Simulation 对战检查仍在后台收尾，请稍候再试。")
        try:
            return self._run_once_sync_impl(config, force_refresh=force_refresh)
        finally:
            self._sync_run_lock.release()

    def _run_once_sync_impl(
        self, config: SimulationMonitorConfig, force_refresh: bool = False
    ) -> tuple[
        SimulationMonitorStatus,
        list[SimulationAgentStats],
        SimulationMedalThresholds | None,
        int,
        list[SimulationHistoryPoint],
        list[dict[str, Any]],
    ]:
        with self._state_lock:
            prev_counts = dict(self._known_episode_counts)
            prev_tiers = dict(self._known_medal_tiers)
            previous_agents = {
                agent.submission_id: agent.model_copy(deep=True)
                for agent in self._status.agents
            }
            previous_thresholds = (
                self._status.thresholds or self._status.medal_thresholds
            )

        return execute_simulation_sync(
            kaggle_client=self._kaggle,
            config=config,
            force_refresh=force_refresh,
            service_started_at=self._service_started_at,
            prev_counts=prev_counts,
            prev_tiers=prev_tiers,
            previous_agents=previous_agents,
            previous_thresholds=previous_thresholds,
            fetch_timeout_seconds=SIMULATION_FETCH_TIMEOUT_SECONDS,
        )

    async def _scheduler_loop(self) -> None:
        while not self._stop_event.is_set():
            with self._state_lock:
                self._status.scheduler_alive = True
                self._status.scheduler_heartbeat_at = _utc_now().isoformat()
            snapshot = self.snapshot()
            if not snapshot.config.enabled:
                self._wake_event.clear()
                try:
                    await asyncio.wait_for(self._wake_event.wait(), timeout=15.0)
                except asyncio.TimeoutError:
                    pass
                continue

            next_run = _parse_datetime(snapshot.status.next_run_at) or _utc_now()
            delay = max(0.0, (next_run - _utc_now()).total_seconds())
            if delay > 0:
                wait_seconds = min(delay, 15.0)
                self._wake_event.clear()
                try:
                    await asyncio.wait_for(
                        self._wake_event.wait(), timeout=wait_seconds
                    )
                    continue
                except asyncio.TimeoutError:
                    if wait_seconds < delay:
                        continue
            self._wake_event.clear()

            if self._stop_event.is_set():
                break
            try:
                await self.run_now(trigger="scheduled")
            except (SimulationMonitorBusyError, ValueError):
                await asyncio.sleep(0)
