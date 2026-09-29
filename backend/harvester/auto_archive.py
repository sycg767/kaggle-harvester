from __future__ import annotations

import asyncio
import json
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from string import hexdigits
from typing import Literal

from .archiver import Archiver
from .kaggle_client import KaggleClient
from .monitors import run_auto_archive_for_competition, run_auto_archive_sync
from .notifications import NotificationManager
from .models import (
    AutoArchiveConfig,
    AutoArchiveCheckedItem,
    AutoArchiveItemResult,
    AutoArchiveRunLog,
    AutoArchiveRunDetail,
    AutoArchiveSnapshot,
    AutoArchiveStatus,
    ScoreDirection,
)


class AutoArchiveBusyError(RuntimeError):
    """已有一次自动检查正在执行。"""


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


class AutoArchiveManager:
    """持久化自动归档配置，并在应用进程内执行定时检查。"""

    SCOREBOARD_PAGE_SIZE = 50
    MAX_RUN_LOGS = 500

    def __init__(
        self,
        kaggle_client: KaggleClient,
        archiver: Archiver,
        harvest_root: str,
        default_competition: str,
        notification_manager: NotificationManager | None = None,
    ) -> None:
        self._kaggle = kaggle_client
        self._archiver = archiver
        self._notifications = notification_manager
        self._state_path = (
            Path(harvest_root).resolve() / "_cache" / "auto_archive.json"
        )
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._run_details_root = self._state_path.parent / "auto_archive_runs"
        self._run_details_root.mkdir(parents=True, exist_ok=True)
        self._state_lock = threading.RLock()
        self._run_lock = asyncio.Lock()
        self._wake_event = asyncio.Event()
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._service_started_at = _utc_now().isoformat()
        self._config = AutoArchiveConfig(competitions=[default_competition])
        self._status = AutoArchiveStatus(
            service_started_at=self._service_started_at,
            scheduler_heartbeat_at=self._service_started_at,
        )
        self._processed_runs: dict[str, dict[str, object]] = {}
        self._logs: list[AutoArchiveRunLog] = []
        self._load_state()

    def _load_state(self) -> None:
        if not self._state_path.exists():
            return
        try:
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
            self._config = AutoArchiveConfig(**data.get("config", {}))
            self._status = AutoArchiveStatus(**data.get("status", {}))
            self._status.running = False
            self._status.scheduler_alive = False
            self._status.service_started_at = self._service_started_at
            self._status.scheduler_heartbeat_at = self._service_started_at
            processed_runs = data.get("processed_runs", {})
            if isinstance(processed_runs, dict):
                self._processed_runs = {
                    str(key): value
                    for key, value in processed_runs.items()
                    if isinstance(value, dict)
                }
            logs = data.get("logs", [])
            if isinstance(logs, list):
                for item in logs[: self.MAX_RUN_LOGS]:
                    try:
                        self._logs.append(AutoArchiveRunLog(**item))
                    except (TypeError, ValueError):
                        continue
        except (json.JSONDecodeError, OSError, ValueError, TypeError):
            # 配置损坏时保持安全默认值：任务关闭且不自动访问 Kaggle。
            self._config.enabled = False
            self._status = AutoArchiveStatus(
                last_error="自动归档配置无法读取，已恢复为关闭状态。",
                service_started_at=self._service_started_at,
                scheduler_heartbeat_at=self._service_started_at,
            )

    def _save_state(self) -> None:
        with self._state_lock:
            payload = {
                "version": 3,
                "updated_at": _utc_now().isoformat(),
                "config": self._config.model_dump(),
                "status": self._status.model_dump(),
                "processed_runs": self._processed_runs,
                "logs": [item.model_dump() for item in self._logs],
            }
            temp_path = self._state_path.with_suffix(".tmp")
            temp_path.write_text(
                json.dumps(payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            temp_path.replace(self._state_path)

    def snapshot(self) -> AutoArchiveSnapshot:
        with self._state_lock:
            status = self._status.model_copy(deep=True)
            if not self._run_lock.locked():
                status.running = False
            status.scheduler_alive = bool(
                self._task is not None and not self._task.done()
            )
            return AutoArchiveSnapshot(
                config=self._config.model_copy(deep=True),
                status=status,
                logs=[item.model_copy(deep=True) for item in self._logs],
            )

    def _run_detail_path(self, log_id: str) -> Path:
        if len(log_id) != 32 or any(char not in hexdigits for char in log_id):
            raise ValueError("运行日志 ID 无效。")
        return self._run_details_root / f"{log_id.lower()}.json"

    def _save_run_detail(
        self, log: AutoArchiveRunLog, items: list[AutoArchiveCheckedItem]
    ) -> None:
        path = self._run_detail_path(log.id)
        temp_path = path.with_suffix(".tmp")
        payload = AutoArchiveRunDetail(log=log, items=items)
        temp_path.write_text(
            json.dumps(payload.model_dump(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        temp_path.replace(path)

    def get_run_detail(self, log_id: str) -> AutoArchiveRunDetail | None:
        with self._state_lock:
            log = next((item for item in self._logs if item.id == log_id), None)
            if log is None:
                return None
            log_copy = log.model_copy(deep=True)
        if not log_copy.details_available:
            return AutoArchiveRunDetail(log=log_copy, items=[])
        try:
            data = json.loads(
                self._run_detail_path(log_id).read_text(encoding="utf-8")
            )
            return AutoArchiveRunDetail(**data)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            log_copy.details_available = False
            return AutoArchiveRunDetail(log=log_copy, items=[])

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
            self._scheduler_loop(), name="kaggle-auto-archive"
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
        self, config: AutoArchiveConfig
    ) -> AutoArchiveSnapshot:
        missing = [
            slug
            for slug in config.competitions
            if config.threshold_for(slug) is None
        ]
        if config.enabled and missing:
            raise ValueError(
                "启用自动归档前必须为每个竞赛设置分数阈值："
                + "、".join(missing)
            )
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
    ) -> AutoArchiveSnapshot:
        if self._run_lock.locked():
            raise AutoArchiveBusyError("自动归档检查正在运行，请稍后再试。")
        missing = [
            slug
            for slug in self._config.competitions
            if self._config.threshold_for(slug) is None
        ]
        if missing:
            raise ValueError(
                "请先为每个竞赛设置分数阈值：" + "、".join(missing)
            )

        async with self._run_lock:
            started_at = _utc_now()
            with self._state_lock:
                self._status.running = True
                self._status.last_error = None
                self._status.next_run_at = None
                self._save_state()
                config = self._config.model_copy(deep=True)

            try:
                # 设定硬超时 300 秒，防止 Kaggle 下载/列表挂起死锁
                status, processed_runs, checked_items = await asyncio.wait_for(
                    asyncio.to_thread(self._run_once_sync, config),
                    timeout=300.0,
                )
            except asyncio.TimeoutError:
                status = AutoArchiveStatus(
                    last_checked_at=_utc_now().isoformat(),
                    last_error="自动归档任务执行超时（300秒），已自动终止并恢复就绪状态。",
                )
                processed_runs = None
                checked_items = []
            except Exception as exc:
                status = AutoArchiveStatus(
                    last_checked_at=_utc_now().isoformat(),
                    last_error=str(exc),
                )
                processed_runs = None
                checked_items = []
            finally:
                with self._state_lock:
                    self._status.running = False
                    self._status.scheduler_alive = True
                    self._status.service_started_at = self._service_started_at
                    self._status.scheduler_heartbeat_at = _utc_now().isoformat()

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
                self._status = status
                if processed_runs is not None:
                    self._processed_runs = processed_runs
                outcome = (
                    "failed"
                    if processed_runs is None
                    else "partial"
                    if status.failed_count > 0
                    else "success"
                )
                log = AutoArchiveRunLog(
                    id=uuid.uuid4().hex,
                    trigger=trigger,
                    outcome=outcome,
                    started_at=started_at.isoformat(),
                    finished_at=finished_at.isoformat(),
                    duration_seconds=round(
                        (finished_at - started_at).total_seconds(), 3
                    ),
                    checked_count=status.checked_count,
                    matched_count=status.matched_count,
                    archived_count=status.archived_count,
                    skipped_count=status.skipped_count,
                    failed_count=status.failed_count,
                    competitions_checked=list(status.competitions_checked),
                    error=status.last_error,
                    details_available=True,
                )
                try:
                    self._save_run_detail(log, checked_items)
                except OSError:
                    log.details_available = False
                self._logs.insert(0, log)
                removed_logs = self._logs[self.MAX_RUN_LOGS :]
                self._logs = self._logs[: self.MAX_RUN_LOGS]
                for removed in removed_logs:
                    try:
                        self._run_detail_path(removed.id).unlink(missing_ok=True)
                    except (OSError, ValueError):
                        pass
                self._save_state()
            if self._notifications is not None:
                try:
                    label = "、".join(config.competitions[:5])
                    if len(config.competitions) > 5:
                        label += f" 等{len(config.competitions)}个"
                    self._notifications.enqueue_run(
                        log, checked_items, label
                    )
                except Exception:
                    # 通知失败不能改变已经完成的归档结果。
                    pass
            self._wake_event.set()
            return self.snapshot()

    def _run_once_for_competition(
        self,
        config: AutoArchiveConfig,
        competition: str,
        threshold: float,
        processed_runs: dict[str, dict[str, object]],
    ) -> tuple[
        list[AutoArchiveItemResult],
        list[AutoArchiveCheckedItem],
        str,
        str,
    ]:
        return run_auto_archive_for_competition(
            kaggle_client=self._kaggle,
            archiver=self._archiver,
            config=config,
            competition=competition,
            threshold=threshold,
            processed_runs=processed_runs,
            page_size=self.SCOREBOARD_PAGE_SIZE,
        )

    def _run_once_sync(
        self, config: AutoArchiveConfig
    ) -> tuple[
        AutoArchiveStatus,
        dict[str, dict[str, object]],
        list[AutoArchiveCheckedItem],
    ]:
        with self._state_lock:
            processed_runs = {
                key: dict(value) for key, value in self._processed_runs.items()
            }

        return run_auto_archive_sync(
            kaggle_client=self._kaggle,
            archiver=self._archiver,
            config=config,
            processed_runs_snapshot=processed_runs,
            page_size=self.SCOREBOARD_PAGE_SIZE,
            run_for_competition_fn=self._run_once_for_competition,
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
                    await asyncio.wait_for(
                        self._wake_event.wait(), timeout=15.0
                    )
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
            except AutoArchiveBusyError:
                await asyncio.sleep(1)
            except Exception as exc:
                await asyncio.sleep(2)
