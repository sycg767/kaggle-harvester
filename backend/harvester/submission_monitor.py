from __future__ import annotations

import asyncio
import json
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from string import hexdigits
from typing import Literal

from .kaggle_client import KaggleClient
from .notifications import NotificationManager
from .models import (
    CompetitionSubmission,
    SubmissionMonitorConfig,
    SubmissionMonitorItem,
    SubmissionMonitorRunDetail,
    SubmissionMonitorRunLog,
    SubmissionMonitorSnapshot,
    SubmissionMonitorStatus,
    SubmissionScoreEvent,
)


class SubmissionMonitorBusyError(RuntimeError):
    """已有一次提交出分检查正在执行。"""


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


class SubmissionMonitorManager:
    """轮询本人竞赛提交，在 Public LB 首次出分时发送通知。"""

    MAX_RUN_LOGS = 200
    MAX_RECENT_EVENTS = 50
    MAX_KNOWN_REFS = 2000

    def __init__(
        self,
        kaggle_client: KaggleClient,
        harvest_root: str,
        default_competition: str,
        notification_manager: NotificationManager | None = None,
    ) -> None:
        self._kaggle = kaggle_client
        self._notifications = notification_manager
        self._state_path = (
            Path(harvest_root).resolve() / "_cache" / "submission_monitor.json"
        )
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._run_details_root = self._state_path.parent / "submission_monitor_runs"
        self._run_details_root.mkdir(parents=True, exist_ok=True)
        self._state_lock = threading.RLock()
        self._run_lock = asyncio.Lock()
        self._wake_event = asyncio.Event()
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._service_started_at = _utc_now().isoformat()
        self._config = SubmissionMonitorConfig(competitions=[default_competition])
        self._status = SubmissionMonitorStatus(
            service_started_at=self._service_started_at,
            scheduler_heartbeat_at=self._service_started_at,
        )
        # key: f"{competition}::{ref}" -> last known public_score
        self._known_scores: dict[str, float | None] = {}
        # key: f"{competition}::{ref}" -> 首次观察到 Public LB 分数的时间
        self._known_scored_at: dict[str, str] = {}
        self._baseline_seeded_by_competition: dict[str, bool] = {}
        self._logs: list[SubmissionMonitorRunLog] = []
        self._load_state()

    def _score_key(self, competition: str, ref: str) -> str:
        return f"{competition}::{ref}"

    def _load_state(self) -> None:
        if not self._state_path.exists():
            return
        try:
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
            self._config = SubmissionMonitorConfig(**data.get("config", {}))
            self._status = SubmissionMonitorStatus(**data.get("status", {}))
            self._status.running = False
            self._status.scheduler_alive = False
            self._status.service_started_at = self._service_started_at
            self._status.scheduler_heartbeat_at = self._service_started_at
            known = data.get("known_scores", {})
            if isinstance(known, dict):
                cleaned: dict[str, float | None] = {}
                legacy_only = True
                for key, value in known.items():
                    ref = str(key)
                    if "::" in ref:
                        legacy_only = False
                    if value is None:
                        cleaned[ref] = None
                    elif isinstance(value, (int, float)):
                        cleaned[ref] = float(value)
                # 旧版 key 仅为 ref：仅当当前只有一个竞赛时挂到该竞赛，否则丢弃并重 seed。
                if cleaned and legacy_only:
                    comps = list(self._config.competitions)
                    if len(comps) == 1:
                        prefix = comps[0]
                        cleaned = {
                            self._score_key(prefix, key): value
                            for key, value in cleaned.items()
                        }
                    else:
                        cleaned = {}
                self._known_scores = cleaned
            known_scored_at = data.get("known_scored_at", {})
            if isinstance(known_scored_at, dict):
                self._known_scored_at = {
                    str(key): str(value)
                    for key, value in known_scored_at.items()
                    if isinstance(value, str) and _parse_datetime(value) is not None
                }
            baselines = data.get("baseline_seeded_by_competition")
            if isinstance(baselines, dict):
                self._baseline_seeded_by_competition = {
                    str(key): bool(value) for key, value in baselines.items()
                }
            elif data.get("baseline_seeded"):
                # 旧全局 baseline：仅迁移到当前唯一竞赛
                comps = list(self._config.competitions)
                if len(comps) == 1:
                    self._baseline_seeded_by_competition = {comps[0]: True}
            logs = data.get("logs", [])
            if isinstance(logs, list):
                for item in logs[: self.MAX_RUN_LOGS]:
                    try:
                        self._logs.append(SubmissionMonitorRunLog(**item))
                    except (TypeError, ValueError):
                        continue
        except (json.JSONDecodeError, OSError, ValueError, TypeError):
            self._config.enabled = False
            self._status = SubmissionMonitorStatus(
                last_error="提交出分监控配置无法读取，已恢复为关闭状态。",
                service_started_at=self._service_started_at,
                scheduler_heartbeat_at=self._service_started_at,
            )

    def _save_state(self) -> None:
        with self._state_lock:
            # 限制已观察 ref 数量，优先保留最近检查出现过的条目。
            if len(self._known_scores) > self.MAX_KNOWN_REFS:
                keep = list(self._known_scores.items())[-self.MAX_KNOWN_REFS :]
                self._known_scores = dict(keep)
            self._known_scored_at = {
                key: value
                for key, value in self._known_scored_at.items()
                if key in self._known_scores
            }
            payload = {
                "version": 2,
                "updated_at": _utc_now().isoformat(),
                "config": self._config.model_dump(),
                "status": self._status.model_dump(),
                "known_scores": self._known_scores,
                "known_scored_at": self._known_scored_at,
                "baseline_seeded_by_competition": self._baseline_seeded_by_competition,
                "logs": [item.model_dump() for item in self._logs],
            }
            temp_path = self._state_path.with_suffix(".tmp")
            temp_path.write_text(
                json.dumps(payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            temp_path.replace(self._state_path)

    def snapshot(self) -> SubmissionMonitorSnapshot:
        with self._state_lock:
            status = self._status.model_copy(deep=True)
            status.scheduler_alive = bool(
                self._task is not None and not self._task.done()
            )
            return SubmissionMonitorSnapshot(
                config=self._config.model_copy(deep=True),
                status=status,
                logs=[item.model_copy(deep=True) for item in self._logs],
            )

    def _run_detail_path(self, log_id: str) -> Path:
        if len(log_id) != 32 or any(char not in hexdigits for char in log_id):
            raise ValueError("运行日志 ID 无效。")
        return self._run_details_root / f"{log_id.lower()}.json"

    def _save_run_detail(
        self, log: SubmissionMonitorRunLog, items: list[SubmissionMonitorItem]
    ) -> None:
        path = self._run_detail_path(log.id)
        temp_path = path.with_suffix(".tmp")
        payload = SubmissionMonitorRunDetail(log=log, items=items)
        temp_path.write_text(
            json.dumps(payload.model_dump(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        temp_path.replace(path)

    def get_run_detail(self, log_id: str) -> SubmissionMonitorRunDetail | None:
        with self._state_lock:
            log = next((item for item in self._logs if item.id == log_id), None)
            if log is None:
                return None
            log_copy = log.model_copy(deep=True)
        detail_path = self._run_detail_path(log_id)
        # 历史 bug：明细文件可能带着 details_available=False 落盘。
        # 以「索引标记 或 明细文件存在」为准，优先返回文件中的 items。
        if not log_copy.details_available and not detail_path.exists():
            return SubmissionMonitorRunDetail(log=log_copy, items=[])
        try:
            data = json.loads(detail_path.read_text(encoding="utf-8"))
            detail = SubmissionMonitorRunDetail(**data)
            # 用内存索引里的汇总覆盖文件内可能过期的 flag。
            fixed_log = log_copy.model_copy(deep=True)
            fixed_log.details_available = True
            return SubmissionMonitorRunDetail(log=fixed_log, items=detail.items)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            log_copy.details_available = False
            return SubmissionMonitorRunDetail(log=log_copy, items=[])

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
            self._scheduler_loop(), name="kaggle-submission-monitor"
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
        self, config: SubmissionMonitorConfig
    ) -> SubmissionMonitorSnapshot:
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
    ) -> SubmissionMonitorSnapshot:
        if self._run_lock.locked():
            raise SubmissionMonitorBusyError("提交出分检查正在运行，请稍后再试。")

        async with self._run_lock:
            started_at = _utc_now()
            with self._state_lock:
                self._status.running = True
                self._status.last_error = None
                self._status.next_run_at = None
                self._save_state()
                config = self._config.model_copy(deep=True)

            try:
                status, known_scores, known_scored_at, baselines, new_events = (
                    await asyncio.to_thread(self._run_once_sync, config)
                )
            except Exception as exc:
                status = SubmissionMonitorStatus(
                    last_checked_at=_utc_now().isoformat(),
                    last_error=str(exc)[:500],
                )
                known_scores = None
                known_scored_at = None
                baselines = None
                new_events = []

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
                # 保留近期事件历史（跨次检查）
                if known_scores is not None:
                    merged_events = list(new_events) + list(
                        self._status.recent_events
                    )
                    seen_keys: set[str] = set()
                    deduped: list[SubmissionScoreEvent] = []
                    for event in merged_events:
                        key = f"{event.competition}::{event.ref}"
                        if key in seen_keys:
                            continue
                        seen_keys.add(key)
                        deduped.append(event)
                        if len(deduped) >= self.MAX_RECENT_EVENTS:
                            break
                    status.recent_events = deduped
                    self._known_scores = known_scores
                    if known_scored_at is not None:
                        self._known_scored_at = known_scored_at
                    if baselines is not None:
                        self._baseline_seeded_by_competition = baselines
                else:
                    status.recent_events = list(self._status.recent_events)
                self._status = status
                outcome: Literal["success", "partial", "failed"] = (
                    "failed"
                    if known_scores is None
                    else "partial"
                    if status.last_error
                    else "success"
                )
                detail_items = list(status.recent_items) if known_scores is not None else []
                log = SubmissionMonitorRunLog(
                    id=uuid.uuid4().hex,
                    trigger=trigger,
                    outcome=outcome,
                    started_at=started_at.isoformat(),
                    finished_at=finished_at.isoformat(),
                    duration_seconds=round(
                        (finished_at - started_at).total_seconds(), 3
                    ),
                    checked_count=status.checked_count,
                    pending_count=status.pending_count,
                    scored_count=status.scored_count,
                    failed_count=status.failed_count,
                    newly_scored_count=status.newly_scored_count,
                    competitions_checked=list(status.competitions_checked),
                    error=status.last_error,
                    # 必须在落盘前设为 True，否则明细文件里的 log 会把前端读成「仅汇总」。
                    details_available=known_scores is not None,
                )
                if known_scores is not None:
                    try:
                        self._save_run_detail(log, detail_items)
                    except (OSError, ValueError, TypeError):
                        log.details_available = False
                self._logs.insert(0, log)
                self._logs = self._logs[: self.MAX_RUN_LOGS]
                self._save_state()

            if self._notifications is not None and new_events:
                try:
                    by_comp: dict[str, list[SubmissionScoreEvent]] = {}
                    for event in new_events:
                        by_comp.setdefault(event.competition or "unknown", []).append(
                            event
                        )
                    for competition, events in by_comp.items():
                        self._notifications.enqueue_submission_scores(
                            competition=competition,
                            events=[event.model_dump() for event in events],
                            checked_at=status.last_checked_at,
                        )
                except Exception:
                    pass
            self._wake_event.set()
            return self.snapshot()

    def _matches_prefix(
        self, submission: CompetitionSubmission, prefix: str
    ) -> bool:
        if not prefix:
            return True
        return (submission.description or "").startswith(prefix)

    @staticmethod
    def _submission_state(submission: CompetitionSubmission) -> Literal["pending", "scored", "failed"]:
        """依据 Kaggle 提交状态分类，避免把失败提交误报为待出分。"""
        normalized = (submission.status or "").strip().lower()
        if normalized in {"error", "failed", "failure", "cancelled", "canceled", "invalid"}:
            return "failed"
        if submission.error_description.strip():
            return "failed"
        if submission.public_score is not None:
            return "scored"
        return "pending"

    def _run_once_sync(
        self, config: SubmissionMonitorConfig
    ) -> tuple[
        SubmissionMonitorStatus,
        dict[str, float | None],
        dict[str, str],
        dict[str, bool],
        list[SubmissionScoreEvent],
    ]:
        with self._state_lock:
            known_scores = dict(self._known_scores)
            known_scored_at = dict(self._known_scored_at)
            baselines = dict(self._baseline_seeded_by_competition)

        prefix = (config.description_prefix or "").strip()
        new_events: list[SubmissionScoreEvent] = []
        recent_items: list[SubmissionMonitorItem] = []
        pending_count = 0
        scored_count = 0
        failed_count = 0
        competitions_checked: list[str] = []
        errors: list[str] = []

        for competition in config.competitions:
            competitions_checked.append(competition)
            try:
                submissions = self._kaggle.list_competition_submissions(
                    competition=competition,
                    page_size=config.page_size,
                )
            except Exception as exc:
                errors.append(f"{competition}: {str(exc)[:200]}")
                continue

            watched = [
                item for item in submissions if self._matches_prefix(item, prefix)
            ]
            seed_baseline = not baselines.get(competition, False)
            comp_new_events: list[SubmissionScoreEvent] = []

            for submission in watched:
                score = submission.public_score
                submission_state = self._submission_state(submission)
                key = self._score_key(competition, submission.ref)
                previous = known_scores.get(key, ...)
                newly_scored = False
                scored_at = known_scored_at.get(key)

                if submission_state == "pending":
                    pending_count += 1
                elif submission_state == "scored":
                    scored_count += 1
                else:
                    failed_count += 1

                if seed_baseline:
                    known_scores[key] = score
                elif previous is ...:
                    if score is not None:
                        newly_scored = True
                    known_scores[key] = score
                else:
                    prev_score = previous  # float | None
                    if prev_score is None and score is not None:
                        newly_scored = True
                    known_scores[key] = score

                if score is not None and not scored_at:
                    scored_at = _utc_now().isoformat()
                    known_scored_at[key] = scored_at

                if newly_scored and score is not None:
                    previous_public = (
                        None if previous is ... else previous  # type: ignore[assignment]
                    )
                    if not isinstance(previous_public, (int, float)):
                        previous_public = None
                    event = SubmissionScoreEvent(
                        competition=competition,
                        ref=submission.ref,
                        description=submission.description,
                        public_score=float(score),
                        public_score_display=(
                            submission.public_score_display
                            or f"{float(score):.6g}"
                        ),
                        status=submission.status,
                        date=submission.date,
                        scored_at=scored_at,
                        submitted_by=submission.submitted_by,
                        submitted_by_ref=submission.submitted_by_ref,
                        team_name=submission.team_name,
                        previous_public_score=(
                            float(previous_public)
                            if previous_public is not None
                            else None
                        ),
                    )
                    comp_new_events.append(event)

                recent_items.append(
                    SubmissionMonitorItem(
                        competition=competition,
                        ref=submission.ref,
                        description=submission.description,
                        status=submission.status,
                        error_description=submission.error_description,
                        submitted_by=submission.submitted_by,
                        submitted_by_ref=submission.submitted_by_ref,
                        team_name=submission.team_name,
                        public_score=score,
                        public_score_display=submission.public_score_display,
                        date=submission.date,
                        scored_at=scored_at,
                        state=submission_state,
                        watched=True,
                        newly_scored=newly_scored and not seed_baseline,
                    )
                )

            if seed_baseline:
                baselines[competition] = True
            else:
                new_events.extend(comp_new_events)
                baselines[competition] = True

        if not competitions_checked and errors:
            raise RuntimeError("；".join(errors))

        status = SubmissionMonitorStatus(
            last_checked_at=_utc_now().isoformat(),
            last_error="；".join(errors) if errors else None,
            checked_count=len(recent_items),
            pending_count=pending_count,
            scored_count=scored_count,
            failed_count=failed_count,
            newly_scored_count=len(new_events),
            competitions_checked=competitions_checked,
            recent_events=new_events,
            recent_items=recent_items[:100],
        )
        return status, known_scores, known_scored_at, baselines, new_events

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
            except (SubmissionMonitorBusyError, ValueError):
                await asyncio.sleep(0)
