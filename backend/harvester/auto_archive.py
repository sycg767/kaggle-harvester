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
        self._config = AutoArchiveConfig(competition=default_competition)
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
                "version": 2,
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
        if config.enabled and config.score_threshold is None:
            raise ValueError("启用自动归档前必须设置分数阈值。")
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
        if self._config.score_threshold is None:
            raise ValueError("请先设置分数阈值。")

        async with self._run_lock:
            started_at = _utc_now()
            with self._state_lock:
                self._status.running = True
                self._status.last_error = None
                self._status.next_run_at = None
                self._save_state()
                config = self._config.model_copy(deep=True)

            try:
                status, processed_runs, checked_items = await asyncio.to_thread(
                    self._run_once_sync, config
                )
            except Exception as exc:
                status = AutoArchiveStatus(
                    last_checked_at=_utc_now().isoformat(),
                    last_error=str(exc),
                )
                processed_runs = None
                checked_items = []

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
                    self._notifications.enqueue_run(
                        log, checked_items, config.competition
                    )
                except Exception:
                    # 通知失败不能改变已经完成的归档结果。
                    pass
            self._wake_event.set()
            return self.snapshot()

    def _run_once_sync(
        self, config: AutoArchiveConfig
    ) -> tuple[
        AutoArchiveStatus,
        dict[str, dict[str, object]],
        list[AutoArchiveCheckedItem],
    ]:
        configured_direction = config.score_direction
        direction_source = "manual"
        if configured_direction == ScoreDirection.AUTO:
            competition_info = self._kaggle.fetch_competition_info(
                config.competition
            )
            effective_direction = (
                ScoreDirection.MINIMIZE
                if competition_info.is_lower_better
                else ScoreDirection.MAXIMIZE
            )
            direction_source = competition_info.score_direction_source
        else:
            effective_direction = configured_direction

        kernels = self._kaggle.list_kernels(
            sort_by=(
                "scoreAscending"
                if effective_direction == ScoreDirection.MINIMIZE
                else "scoreDescending"
            ),
            page_size=self.SCOREBOARD_PAGE_SIZE,
            max_pages=1,
            competition=config.competition,
        )
        scored = self._kaggle.enrich_kernel_summaries(
            kernels,
            competition=config.competition,
            score_limit=self.SCOREBOARD_PAGE_SIZE,
        )
        if effective_direction == ScoreDirection.MINIMIZE:
            matched = [
                kernel
                for kernel in scored
                if kernel.public_score is not None
                and kernel.public_score < config.score_threshold  # type: ignore[operator]
            ]
        else:
            matched = [
                kernel
                for kernel in scored
                if kernel.public_score is not None
                and kernel.public_score > config.score_threshold  # type: ignore[operator]
            ]

        with self._state_lock:
            processed_runs = {
                key: dict(value) for key, value in self._processed_runs.items()
            }

        results: list[AutoArchiveItemResult] = []
        for kernel in matched:
            score = float(kernel.public_score)  # 已由筛选保证不为空。
            processed_key = f"{config.competition}::{kernel.ref}"
            processed = processed_runs.get(processed_key, {})
            processed_version = processed.get("version_number")
            archive_exists = False
            if isinstance(processed_version, int) and "/" in kernel.ref:
                owner, slug = kernel.ref.split("/", 1)
                entry = self._archiver.get_archive(
                    f"{owner}__{slug}__v{processed_version}"
                )
                archive_exists = bool(entry and Path(entry.path).exists())

            if (
                kernel.last_run_time
                and processed.get("last_run_time") == kernel.last_run_time
                and archive_exists
            ):
                results.append(
                    AutoArchiveItemResult(
                        ref=kernel.ref,
                        public_score=score,
                        status="skipped",
                        version_number=processed_version,
                    )
                )
                continue

            try:
                archived = self._archiver.archive_kernel(
                    kernel_ref=kernel.ref,
                    score_direction=effective_direction.value,
                    include_outputs=config.include_outputs,
                    competition=config.competition,
                )
                selected_score = score
                try:
                    versions = self._kaggle.get_kernel_versions(kernel.ref)
                    selected = next(
                        (
                            version
                            for version in versions.versions
                            if version.version_number == archived.selected_version
                        ),
                        None,
                    )
                    if selected and selected.public_lb_numeric is not None:
                        selected_score = selected.public_lb_numeric
                except Exception:
                    # 归档已经成功时，分数回填失败不应把本地文件标为失败。
                    pass
                self._archiver.update_public_score(
                    (
                        f"{archived.owner_slug}__{archived.kernel_slug}__"
                        f"v{archived.selected_version}"
                    ),
                    selected_score,
                )
                if kernel.last_run_time:
                    processed_runs[processed_key] = {
                        "last_run_time": kernel.last_run_time,
                        "version_number": archived.selected_version,
                    }
                results.append(
                    AutoArchiveItemResult(
                        ref=kernel.ref,
                        public_score=score,
                        status=(
                            "skipped" if archived.already_existed else "archived"
                        ),
                        version_number=archived.selected_version,
                    )
                )
            except Exception as exc:
                results.append(
                    AutoArchiveItemResult(
                        ref=kernel.ref,
                        public_score=score,
                        status="failed",
                        error=str(exc)[:500],
                    )
                )

        failed = [item for item in results if item.status == "failed"]
        result_by_ref = {item.ref: item for item in results}
        checked_items: list[AutoArchiveCheckedItem] = []
        for kernel in scored:
            result = result_by_ref.get(kernel.ref)
            checked_items.append(
                AutoArchiveCheckedItem(
                    ref=kernel.ref,
                    title=kernel.title,
                    author=kernel.author,
                    public_score=kernel.public_score,
                    last_run_time=kernel.last_run_time,
                    matched=result is not None,
                    action=result.status if result is not None else "not_matched",
                    version_number=(
                        result.version_number if result is not None else None
                    ),
                    error=result.error if result is not None else None,
                )
            )

        status = AutoArchiveStatus(
            last_checked_at=_utc_now().isoformat(),
            last_error=(
                f"{len(failed)} 个 Kernel 归档失败，请查看最近结果。"
                if failed
                else None
            ),
            checked_count=len(scored),
            matched_count=len(matched),
            archived_count=sum(item.status == "archived" for item in results),
            skipped_count=sum(item.status == "skipped" for item in results),
            failed_count=len(failed),
            effective_score_direction=effective_direction.value,
            score_direction_source=direction_source,
            recent_results=results,
        )
        return status, processed_runs, checked_items

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
            except (AutoArchiveBusyError, ValueError):
                # 配置变更或手动检查会唤醒循环，下一轮重新计算时间。
                await asyncio.sleep(0)
