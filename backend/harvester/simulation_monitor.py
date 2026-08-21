from __future__ import annotations

import asyncio
import concurrent.futures
import json
import os
import socket
import threading
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from string import hexdigits
from typing import Any, Literal

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
    SimulationMonitorRunDetail,
    SimulationMonitorRunLog,
    SimulationMonitorSnapshot,
    SimulationMonitorStatus,
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
        harvest_root: str,
        default_competition: str = "pokemon-tcg-ai-battle",
        notification_manager: NotificationManager | None = None,
    ) -> None:
        self._kaggle = kaggle_client
        self._notifications = notification_manager
        self._state_path = (
            Path(harvest_root).resolve() / "_cache" / "simulation_monitor.json"
        )
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._run_details_root = self._state_path.parent / "simulation_monitor_runs"
        self._run_details_root.mkdir(parents=True, exist_ok=True)
        self._state_lock = threading.RLock()
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

    _clawbot_status_cache: tuple[float, SimulationClawbotStatus] | None = None

    @staticmethod
    def _probe_gateway(host: str, port: int, timeout: float = 0.05) -> bool:
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            return False

    @staticmethod
    def _get_docker_host_ip() -> str | None:
        try:
            with open("/proc/net/route", "r", encoding="utf-8") as f:
                for line in f:
                    fields = line.strip().split()
                    if len(fields) >= 3 and fields[1] == "00000000":
                        val = int(fields[2], 16)
                        return f"{val & 0xFF}.{(val >> 8) & 0xFF}.{(val >> 16) & 0xFF}.{(val >> 24) & 0xFF}"
        except Exception:
            pass
        return None

    @classmethod
    def _get_clawbot_status(cls, force: bool = False) -> SimulationClawbotStatus:
        import time
        now = time.time()
        if not force and cls._clawbot_status_cache is not None:
            cached_time, cached_status = cls._clawbot_status_cache
            if now - cached_time < 30.0:
                return cached_status

        # 1. 尝试定位 openclaw.json 配置文件（支持自定义路径、标准路径及容器内路径）
        possible_paths: list[Path] = []
        custom_cfg = os.getenv("OPENCLAW_CONFIG_PATH")
        if custom_cfg:
            possible_paths.append(Path(custom_cfg))
        openclaw_home = os.getenv("OPENCLAW_HOME")
        if openclaw_home:
            possible_paths.append(Path(openclaw_home) / "openclaw.json")
        try:
            possible_paths.append(Path.home() / ".openclaw" / "openclaw.json")
        except Exception:
            pass
        possible_paths.extend([
            Path("/root/.openclaw/openclaw.json"),
            Path("/app/.openclaw/openclaw.json"),
            Path("data/.openclaw/openclaw.json"),
        ])

        cfg_data: dict[str, Any] | None = None
        for p in possible_paths:
            if p.is_file():
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        cfg_data = json.load(f)
                    break
                except Exception:
                    pass

        # 2. 提取配置信息（支持文件配置与环境变量混合）
        provider_name = None
        base_url = os.getenv("OPENCLAW_LLM_BASE_URL")
        model_name = os.getenv("OPENCLAW_LLM_MODEL")
        updated_at = None
        gateway_port = int(os.getenv("OPENCLAW_GATEWAY_PORT", "18789"))
        gateway_url = os.getenv("OPENCLAW_GATEWAY_URL")
        configured = bool(os.getenv("OPENCLAW_LLM_API_KEY") or cfg_data)

        if cfg_data:
            providers = cfg_data.get("models", {}).get("providers", {})
            if providers:
                provider_name = next(iter(providers.keys()))
                if not base_url:
                    base_url = providers.get(provider_name, {}).get("baseUrl")
            primary_model = cfg_data.get("agents", {}).get("defaults", {}).get("model", {}).get("primary")
            if primary_model and not model_name:
                model_name = primary_model.split("/")[-1]
            updated_at = cfg_data.get("meta", {}).get("lastTouchedAt")
            gw = cfg_data.get("gateway", {})
            if "port" in gw and not os.getenv("OPENCLAW_GATEWAY_PORT"):
                try:
                    gateway_port = int(gw["port"])
                except (ValueError, TypeError):
                    pass

        if not provider_name:
            if base_url and "tokenrhythm" in base_url.lower():
                provider_name = "TokenRhythm Studio"
            elif base_url:
                provider_name = "Custom Provider"

        if not model_name and configured:
            model_name = "deepseek-v4-flash-0731"

        # 3. 真实在线探测 (Real-time Live Online Probing)
        is_online = False
        active_gateway = None

        if gateway_url:
            try:
                parsed = urllib.parse.urlparse(gateway_url)
                host = parsed.hostname or "127.0.0.1"
                port = parsed.port or gateway_port
                if cls._probe_gateway(host, port):
                    is_online = True
                    active_gateway = gateway_url
            except Exception:
                pass

        if not is_online:
            # 候选网关探测（包括本地回路、Docker 宿主别名、Linux 默认网桥及路由网关）
            candidate_hosts = ["127.0.0.1", "localhost", "host.docker.internal", "172.17.0.1"]
            docker_host = cls._get_docker_host_ip()
            if docker_host and docker_host not in candidate_hosts:
                candidate_hosts.append(docker_host)

            for host in candidate_hosts:
                if cls._probe_gateway(host, gateway_port):
                    is_online = True
                    active_gateway = f"http://{host}:{gateway_port}"
                    break

        res = SimulationClawbotStatus(
            enabled=is_online,
            is_online=is_online,
            configured=configured,
            provider=provider_name,
            model=model_name,
            base_url=base_url,
            gateway_url=active_gateway or (gateway_url or f"http://127.0.0.1:{gateway_port}"),
            updated_at=updated_at,
        )
        cls._clawbot_status_cache = (now, res)
        return res

    @classmethod
    def test_clawbot(cls) -> SimulationClawbotTestResult:
        import time
        status = cls._get_clawbot_status()
        gateway_port = int(os.getenv("OPENCLAW_GATEWAY_PORT", "18789"))
        gateway_url = os.getenv("OPENCLAW_GATEWAY_URL")

        targets: list[tuple[str, str, int]] = []
        if gateway_url:
            try:
                parsed = urllib.parse.urlparse(gateway_url)
                targets.append((gateway_url, parsed.hostname or "127.0.0.1", parsed.port or gateway_port))
            except Exception:
                pass

        targets.extend([
            (f"http://127.0.0.1:{gateway_port}", "127.0.0.1", gateway_port),
            (f"http://localhost:{gateway_port}", "localhost", gateway_port),
            (f"http://host.docker.internal:{gateway_port}", "host.docker.internal", gateway_port),
            (f"http://172.17.0.1:{gateway_port}", "172.17.0.1", gateway_port),
        ])

        docker_host = cls._get_docker_host_ip()
        if docker_host and docker_host not in ["127.0.0.1", "172.17.0.1"]:
            targets.append((f"http://{docker_host}:{gateway_port}", docker_host, gateway_port))

        candidates: list[SimulationClawbotTestCandidate] = []
        first_success_url: str | None = None
        first_latency: float | None = None

        seen_targets = set()
        for display_url, host, port in targets:
            if display_url in seen_targets:
                continue
            seen_targets.add(display_url)

            start = time.perf_counter()
            reachable = cls._probe_gateway(host, port, timeout=0.5)
            latency = round((time.perf_counter() - start) * 1000, 1)

            if reachable:
                detail = f"TCP 端口 {port} 握手成功 ({latency}ms)"
                if not first_success_url:
                    first_success_url = display_url
                    first_latency = latency
            else:
                detail = "连接失败 (Connection Refused 或超时)"

            candidates.append(
                SimulationClawbotTestCandidate(
                    target=display_url,
                    reachable=reachable,
                    latency_ms=latency if reachable else None,
                    detail=detail,
                )
            )

        success = bool(first_success_url)
        message = (
            f"成功连接至 OpenClaw 网关 ({first_success_url})，微信长连接已就绪！"
            if success
            else "未能连接至任何候选 OpenClaw 网关 (端口 18789)。请确认 OpenClaw 网关是否已在宿主机或容器中运行 (openclaw gateway run)。"
        )

        return SimulationClawbotTestResult(
            success=success,
            message=message,
            active_url=first_success_url,
            latency_ms=first_latency,
            configured=status.configured,
            config_file_found=os.getenv("OPENCLAW_CONFIG_PATH") or (str(Path.home() / ".openclaw" / "openclaw.json") if (Path.home() / ".openclaw" / "openclaw.json").exists() else None),
            model=status.model,
            provider=status.provider,
            candidates=candidates,
        )

    def snapshot(self) -> SimulationMonitorSnapshot:
        with self._state_lock:
            status = self._status.model_copy(deep=True)
            status.scheduler_alive = bool(
                self._task is not None and not self._task.done()
            )
            status.history_points = [item.model_copy(deep=True) for item in self._history_points]
            status.clawbot = self._get_clawbot_status()
            return SimulationMonitorSnapshot(
                config=self._config.model_copy(deep=True),
                status=status,
                logs=[item.model_copy(deep=True) for item in self._logs],
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
            self._config = config.model_copy(deep=True)
            self._status.next_run_at = (
                (_utc_now() + timedelta(minutes=config.interval_minutes)).isoformat()
                if config.enabled
                else None
            )
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
                        asyncio.to_thread(self._run_once_sync, config),
                        timeout=25.0,
                    )
                except asyncio.TimeoutError:
                    status = SimulationMonitorStatus(
                        competition=config.competition,
                        last_checked_at=_utc_now().isoformat(),
                        last_error="Kaggle 网络请求超时 (25秒)，本次检查已安全中止。",
                    )
                except Exception as exc:
                    status = SimulationMonitorStatus(
                        competition=config.competition,
                        last_checked_at=_utc_now().isoformat(),
                        last_error=str(exc)[:500],
                    )

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
                            "description": a.description,
                            "public_score": a.public_score,
                            "score": a.score,
                            "rank": a.rank,
                            "wins": a.wins,
                            "losses": a.losses,
                            "ties": a.ties,
                            "win_rate": a.win_rate,
                            "bronze_gap_score": a.bronze_gap_score,
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

    def _run_once_sync(
        self, config: SimulationMonitorConfig
    ) -> tuple[
        SimulationMonitorStatus,
        list[SimulationAgentStats],
        SimulationMedalThresholds | None,
        int,
        list[SimulationHistoryPoint],
        list[dict[str, Any]],
    ]:
        comp = config.competition.strip()
        errors: list[str] = []

        # 1. 确定监控的目标 Submission IDs (支持团队中任意成员提交的 Agent 编号)
        target_submissions: list[CompetitionSubmission] = []
        target_ids_list = config.target_submission_ids or config.submission_ids
        if target_ids_list:
            for tid in target_ids_list:
                try:
                    tid_int = int(str(tid).strip())
                except (ValueError, TypeError):
                    continue
                target_submissions.append(
                    CompetitionSubmission(
                        ref=str(tid_int),
                        description=f"Agent #{tid_int}",
                        status="complete",
                    )
                )
        else:
            # 只有在未指定 target_submission_ids 时，才尝试拉取个人最新提交
            try:
                submissions = self._kaggle.list_competition_submissions(
                    competition=comp, page_size=50
                )
                for s in submissions:
                    norm_status = (s.status or "").lower()
                    if "error" not in norm_status and "fail" not in norm_status:
                        target_submissions.append(s)
                        if len(target_submissions) >= 2:
                            break
                if not target_submissions and submissions:
                    target_submissions = submissions[:2]
            except Exception as exc:
                errors.append(f"获取个人提交失败: {str(exc)[:200]}")

        if not target_submissions:
            # 最后的默认保底 (p46 与 p31)
            target_submissions = [
                CompetitionSubmission(
                    ref="55565346",
                    description="Agent #1 (p46)",
                    status="complete",
                ),
                CompetitionSubmission(
                    ref="55555162",
                    description="Agent #2 (p31)",
                    status="complete",
                ),
            ]

        # 2. 并行拉取全量天梯榜单与目标提交对局数据（大幅降低网络等待时间）
        thresholds: SimulationMedalThresholds | None = None
        leaderboard_rows: list[dict[str, Any]] = []
        episodes_map: dict[int, list[SimulationEpisode]] = {}

        def _fetch_leaderboard():
            nonlocal thresholds, leaderboard_rows
            try:
                thresholds, leaderboard_rows = self._kaggle.get_simulation_leaderboard(
                    competition=comp,
                    bronze_percentile=config.bronze_percentile,
                )
            except Exception as exc:
                errors.append(f"天梯榜单读取失败: {str(exc)[:200]}")

        def _fetch_sub_episodes(target_sub_id: int):
            try:
                episodes_map[target_sub_id] = self._kaggle.list_simulation_episodes(
                    submission_id=target_sub_id, competition=comp
                )
            except Exception as exc:
                errors.append(f"提交 #{target_sub_id} 对局流水读取失败: {str(exc)[:200]}")
                episodes_map[target_sub_id] = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(3, len(target_submissions) + 1)) as executor:
            futures = [executor.submit(_fetch_leaderboard)]
            for sub in target_submissions:
                futures.append(executor.submit(_fetch_sub_episodes, int(str(sub.ref))))
            done, not_done = concurrent.futures.wait(futures, timeout=18.0)
            if not_done:
                errors.append("部分天梯/对局数据拉取超时 (18秒)")

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
        checked_time = _utc_now().isoformat()

        with self._state_lock:
            prev_counts = dict(self._known_episode_counts)
            prev_tiers = dict(self._known_medal_tiers)

        for sub in target_submissions:
            sub_id = int(str(sub.ref))
            episodes: list[SimulationEpisode] = episodes_map.get(sub_id, [])

            wins = sum(1 for ep in episodes if ep.result == "win")
            losses = sum(1 for ep in episodes if ep.result == "loss")
            ties = sum(1 for ep in episodes if ep.result == "tie")
            total = len(episodes)
            win_rate = round((wins / total * 100), 1) if total > 0 else 0.0

            # 匹配队伍名与 Rank
            my_team_name = sub.team_name or ""
            if not my_team_name and episodes:
                my_team_name = episodes[0].my_team_name or ""
            if not my_team_name:
                my_team_name = "GrimmsnaRL"

            rank: int | None = None
            if my_team_name:
                rank = team_ranks.get(my_team_name.strip().lower())

            # 奖牌计算
            bronze_cutoff = thresholds.bronze_cutoff_score if thresholds else None
            silver_cutoff = thresholds.silver_cutoff_score if thresholds else None
            gold_cutoff = thresholds.gold_cutoff_score if thresholds else None
            bronze_rank = thresholds.bronze_cutoff_rank if thresholds else None
            silver_rank = thresholds.silver_cutoff_rank if thresholds else None
            gold_rank = thresholds.gold_cutoff_rank if thresholds else None

            score = sub.public_score
            if score is None and my_team_name and my_team_name.strip().lower() in team_scores:
                score = team_scores[my_team_name.strip().lower()]

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

            # 若底层未直接给出 score_delta / opponent_score，则回退到 Elo 估算
            agent_score_for_calc = score if score is not None else 800.0
            for ep in episodes:
                if ep.opponent_score is None:
                    opp_key = ep.opponent_team_name.strip().lower() if ep.opponent_team_name else ""
                    opp_score = team_scores.get(opp_key) if opp_key else None
                    if opp_score is None and ep.opponent_team_id:
                        opp_score = team_scores.get(str(ep.opponent_team_id))
                    ep.opponent_score = opp_score

                if ep.score_delta is None:
                    eff_opp_score = ep.opponent_score if ep.opponent_score is not None else 800.0
                    try:
                        exp_win = 1.0 / (1.0 + 10.0 ** ((eff_opp_score - agent_score_for_calc) / 400.0))
                    except Exception:
                        exp_win = 0.5

                    actual = 1.0 if ep.result == "win" else (0.0 if ep.result == "loss" else 0.5)
                    k_factor = 8.0
                    delta = round(k_factor * (actual - exp_win), 1)
                    if ep.result == "win" and delta < 0.5:
                        delta = 1.0
                    elif ep.result == "loss" and delta > -0.5:
                        delta = -1.0
                    ep.score_delta = delta

            agent_stat = SimulationAgentStats(
                submission_id=sub_id,
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
                win_rate=win_rate,
                recent_episodes=episodes[:50],
                bronze_gap_score=bronze_gap_score,
                bronze_gap_rank=bronze_gap_rank,
                medal_tier=medal_tier,
                last_updated=checked_time,
            )
            agents_stats.append(agent_stat)

            # 历史点记录
            new_history_points.append(
                SimulationHistoryPoint(
                    timestamp=checked_time,
                    submission_id=sub_id,
                    score=score,
                    rank=rank,
                    total_episodes=total,
                    wins=wins,
                    losses=losses,
                    ties=ties,
                    win_rate=win_rate,
                    bronze_gap_score=bronze_gap_score,
                    bronze_cutoff_score=bronze_cutoff,
                )
            )

            # 对比增量对局与通知
            prev_cnt = prev_counts.get(str(sub_id))
            prev_tier = prev_tiers.get(str(sub_id))
            if prev_cnt is not None and total > prev_cnt:
                new_cnt = total - prev_cnt
                new_episodes_total += new_cnt
                if config.notify_on_new_matches:
                    latest_ep = episodes[0] if episodes else None
                    events_to_notify.append({
                        "type": "new_episodes",
                        "submission_id": sub_id,
                        "description": sub.description,
                        "new_matches": new_cnt,
                        "total_matches": total,
                        "wins": wins,
                        "losses": losses,
                        "win_rate": win_rate,
                        "public_score": score,
                        "rank": rank,
                        "bronze_gap_score": bronze_gap_score,
                        "opponent_name": latest_ep.opponent_team_name if latest_ep else None,
                        "opponent_score": latest_ep.opponent_score if latest_ep else None,
                        "result": latest_ep.result if latest_ep else None,
                        "score_delta": latest_ep.score_delta if latest_ep else None,
                    })

            if prev_tier is not None and prev_tier != medal_tier and medal_tier != "unknown":
                if config.notify_on_medal_change:
                    events_to_notify.append({
                        "type": "medal_change",
                        "submission_id": sub_id,
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
            service_started_at=self._service_started_at,
            scheduler_heartbeat_at=checked_time,
            last_checked_at=checked_time,
            next_run_at=(
                _utc_now() + timedelta(minutes=config.interval_minutes)
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
