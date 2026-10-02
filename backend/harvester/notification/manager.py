from __future__ import annotations

import asyncio
import json
import threading
import uuid
from pathlib import Path
from typing import Any, Optional

from ..schemas import (
    AutoArchiveCheckedItem,
    AutoArchiveRunLog,
    NotificationChannelResult,
    NotificationConfig,
    NotificationConfigUpdate,
    NotificationConfigView,
    NotificationSnapshot,
    NotificationStatus,
    NotificationTestResult,
)
from ..schemas.notifications import NotificationDelivery
from .formatters import (
    format_beijing_time,
    format_run_message,
    format_simulation_event_message,
    format_submission_score_message,
    utc_now_iso,
)
from .secrets import NotificationSecretStore
from .transports import (
    detect_webhook_format,
    maybe_fix_webhook_format,
    send_email,
    send_wechat,
    send_webhook,
    valid_email,
    validate_webhook_url,
)

_utc_now_iso = utc_now_iso
_format_beijing_time = format_beijing_time


class NotificationManager:
    """持久化全局通知配置，并在后台可靠发送事件。"""

    STATE_VERSION = 2
    MAX_DELIVERED_EVENTS = 200
    MAX_ATTEMPTS = 3

    def __init__(
        self,
        harvest_root: str | Path,
        secret_store: Optional[NotificationSecretStore] = None,
    ) -> None:
        cache_root = Path(harvest_root).resolve() / "_cache"
        cache_root.mkdir(parents=True, exist_ok=True)
        self._state_path = cache_root / "notifications.json"
        self._secret_store = secret_store or NotificationSecretStore(
            cache_root / "notification_secrets.dat"
        )
        self._lock = threading.RLock()
        self._config = NotificationConfig()
        self._status = NotificationStatus()
        self._pending: dict[str, dict[str, Any]] = {}
        self._delivered: dict[str, list[str]] = {}
        self._delivery_history: list[NotificationDelivery] = []
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._queued_ids: set[str] = set()
        self._task: asyncio.Task[None] | None = None
        self._load_state()

    @staticmethod
    def detect_webhook_format(url: str) -> Optional[str]:
        return detect_webhook_format(url)

    def _maybe_fix_webhook_format(
        self, format_name: str, webhook_url: str
    ) -> str:
        return maybe_fix_webhook_format(format_name, webhook_url)

    def _load_state(self) -> None:
        if not self._state_path.exists():
            return
        migrated_format = False
        try:
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
            version = data.get("version")
            if version not in {1, self.STATE_VERSION}:
                return
            config_data = dict(data.get("config", {}))
            config_data.setdefault("notify_on_score", True)
            config_data.setdefault("notify_on_simulation", True)
            config_data.setdefault("wechat_enabled", False)
            self._config = NotificationConfig(**config_data)
            self._status = NotificationStatus(**data.get("status", {}))
            pending = data.get("pending", {})
            delivered = data.get("delivered", {})
            if isinstance(pending, dict):
                self._pending = {
                    str(key): value
                    for key, value in pending.items()
                    if isinstance(value, dict)
                }
            if isinstance(delivered, dict):
                self._delivered = {
                    str(key): [str(channel) for channel in value]
                    for key, value in delivered.items()
                    if isinstance(value, list)
                }
            for item in data.get("delivery_history", [])[:self.MAX_DELIVERED_EVENTS]:
                try:
                    self._delivery_history.append(NotificationDelivery.model_validate(item))
                except (TypeError, ValueError):
                    continue
            webhook_url = self._secret_store.get("webhook_url")
            fixed = self._maybe_fix_webhook_format(
                self._config.webhook_format, webhook_url
            )
            if fixed != self._config.webhook_format:
                self._config.webhook_format = fixed  # type: ignore[assignment]
                migrated_format = True
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            self._config = NotificationConfig()
            self._status = NotificationStatus(
                last_error="通知配置无法读取，已恢复为关闭状态。"
            )
            self._pending = {}
            self._delivered = {}
            migrated_format = False
        self._status.worker_alive = False
        self._status.pending_count = len(self._pending)
        if migrated_format:
            try:
                self._save_state()
            except OSError:
                pass

    def _save_state(self) -> None:
        with self._lock:
            self._status.pending_count = len(self._pending)
            payload = {
                "version": self.STATE_VERSION,
                "updated_at": _utc_now_iso(),
                "config": self._config.model_dump(),
                "status": self._status.model_dump(),
                "pending": self._pending,
                "delivered": self._delivered,
                "delivery_history": [item.model_dump() for item in self._delivery_history],
            }
            temp_path = self._state_path.with_suffix(".tmp")
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp_path.replace(self._state_path)

    def health_status(self) -> dict[str, Any]:
        """Read delivery counters without accessing configuration secrets."""
        with self._lock:
            status = self._status.model_dump()
            status["worker_alive"] = bool(self._task is not None and not self._task.done())
            status["pending_count"] = len(self._pending)
            return status

    def snapshot(self) -> NotificationSnapshot:
        with self._lock:
            config = NotificationConfigView(
                **self._config.model_dump(),
                webhook_configured=bool(self._secret_store.get("webhook_url")),
                smtp_password_configured=bool(
                    self._secret_store.get("smtp_password")
                ),
                secret_storage=self._secret_store.storage_mode,
            )
            status = self._status.model_copy(deep=True)
            status.worker_alive = bool(
                self._task is not None and not self._task.done()
            )
            status.pending_count = len(self._pending)
            history = [item.model_copy(deep=True) for item in self._delivery_history]
        return NotificationSnapshot(config=config, status=status, deliveries=history)

    @staticmethod
    def _validate_webhook_url(value: str) -> None:
        validate_webhook_url(value)

    @staticmethod
    def _valid_email(value: str) -> bool:
        return valid_email(value)

    def _validate_config(
        self,
        config: NotificationConfig,
        webhook_url: str,
        smtp_password: str,
    ) -> None:
        if (config.wechat_enabled or config.webhook_enabled or config.email_enabled) and not (
            config.notify_on_archive
            or config.notify_on_failure
            or config.notify_on_score
            or config.notify_on_simulation
        ):
            raise ValueError("至少选择一种通知事件。")
        if config.webhook_enabled:
            if not webhook_url:
                raise ValueError("启用 Webhook 前必须配置地址。")
            self._validate_webhook_url(webhook_url)
        if config.email_enabled:
            if not config.smtp_host.strip():
                raise ValueError("启用邮件前必须配置 SMTP 服务器。")
            if not config.smtp_from.strip() or not self._valid_email(
                config.smtp_from.strip()
            ):
                raise ValueError("发件人邮箱格式无效。")
            if not config.smtp_to:
                raise ValueError("至少配置一个收件人。")
            invalid = [item for item in config.smtp_to if not self._valid_email(item)]
            if invalid:
                raise ValueError("收件人邮箱格式无效。")
            if config.smtp_username.strip() and not smtp_password:
                raise ValueError("SMTP 用户名已填写，但密码尚未配置。")

    async def update_config(
        self, request: NotificationConfigUpdate
    ) -> NotificationSnapshot:
        current_webhook = self._secret_store.get("webhook_url")
        current_password = self._secret_store.get("smtp_password")
        provided = request.model_dump(exclude_unset=True)
        webhook_url = (
            ""
            if request.clear_webhook_url
            else (request.webhook_url or "").strip() or current_webhook
        )
        smtp_password = (
            ""
            if request.clear_smtp_password
            else request.smtp_password or current_password
        )

        with self._lock:
            current = self._config.model_dump()

        for key in (
            "notify_on_archive",
            "notify_on_failure",
            "notify_on_score",
            "notify_on_simulation",
            "wechat_enabled",
            "webhook_enabled",
            "webhook_format",
            "email_enabled",
            "smtp_port",
            "smtp_security",
        ):
            if key in provided and provided[key] is not None:
                current[key] = provided[key]

        if "smtp_host" in provided and provided["smtp_host"] is not None:
            current["smtp_host"] = str(provided["smtp_host"]).strip()
        if "smtp_username" in provided and provided["smtp_username"] is not None:
            current["smtp_username"] = str(provided["smtp_username"]).strip()
        if "smtp_from" in provided and provided["smtp_from"] is not None:
            current["smtp_from"] = str(provided["smtp_from"]).strip()
        if "smtp_to" in provided and provided["smtp_to"] is not None:
            current["smtp_to"] = list(
                dict.fromkeys(
                    item.strip().lower()
                    for item in provided["smtp_to"]
                    if item and item.strip()
                )
            )

        current["webhook_format"] = self._maybe_fix_webhook_format(
            str(current.get("webhook_format") or "feishu"),
            webhook_url,
        )

        config = NotificationConfig(**current)
        self._validate_config(config, webhook_url, smtp_password)
        secret_updates: dict[str, Optional[str]] = {}
        if request.clear_webhook_url or (request.webhook_url or "").strip():
            secret_updates["webhook_url"] = webhook_url or None
        if request.clear_smtp_password or request.smtp_password:
            secret_updates["smtp_password"] = smtp_password or None
        if secret_updates:
            self._secret_store.update(secret_updates)
        with self._lock:
            self._config = config
            self._status.last_error = None
            self._save_state()
        await self.retry_pending()
        return self.snapshot()

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._status.worker_alive = True
        self._task = asyncio.create_task(
            self._worker_loop(), name="notification-dispatcher"
        )
        await self.retry_pending()

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
        with self._lock:
            self._status.worker_alive = False
            self._save_state()

    def _queue_event(self, event_id: str) -> None:
        if event_id in self._queued_ids:
            return
        self._queued_ids.add(event_id)
        self._queue.put_nowait(event_id)

    async def retry_pending(self) -> None:
        with self._lock:
            event_ids = list(self._pending)
        for event_id in event_ids:
            self._queue_event(event_id)

    async def wait_until_idle(self) -> None:
        await self._queue.join()

    def enqueue_run(
        self,
        log: AutoArchiveRunLog,
        items: list[AutoArchiveCheckedItem],
        competition: str,
    ) -> bool:
        with self._lock:
            channels = self._enabled_channels(self._config)
            should_notify = (
                log.archived_count > 0 and self._config.notify_on_archive
            ) or (
                (log.failed_count > 0 or log.outcome == "failed")
                and self._config.notify_on_failure
            )
            if not channels or not should_notify:
                return False
            if log.id in self._pending or log.id in self._delivered:
                return False
            title, text = self._format_run_message(log, items, competition)
            event = {
                "id": log.id,
                "event": "auto_archive_run",
                "title": title,
                "text": text,
                "competition": competition,
                "created_at": log.finished_at,
                "channels": channels,
                "summary": {
                    "checked": log.checked_count,
                    "matched": log.matched_count,
                    "archived": log.archived_count,
                    "skipped": log.skipped_count,
                    "failed": log.failed_count,
                },
            }
            self._pending[log.id] = event
            for channel in channels:
                self._record_delivery(event, channel, "queued", 0)
            self._save_state()
        self._queue_event(log.id)
        return True

    def enqueue_event(
        self,
        event_id: str,
        *,
        event_type: str,
        title: str,
        text: str,
        competition: str = "",
        created_at: Optional[str] = None,
        summary: Optional[dict[str, Any]] = None,
        require_score_switch: bool = False,
    ) -> bool:
        with self._lock:
            channels = self._enabled_channels(self._config)
            if not channels:
                return False
            if require_score_switch and not self._config.notify_on_score:
                return False
            if event_id in self._pending or event_id in self._delivered:
                return False
            event = {
                "id": event_id,
                "event": event_type,
                "title": title,
                "text": text,
                "competition": competition,
                "created_at": created_at or _utc_now_iso(),
                "channels": channels,
                "summary": summary or {},
            }
            self._pending[event_id] = event
            for channel in channels:
                self._record_delivery(event, channel, "queued", 0)
            self._save_state()
        self._queue_event(event_id)
        return True

    def enqueue_submission_scores(
        self,
        *,
        competition: str,
        events: list[dict[str, Any]],
        checked_at: Optional[str] = None,
    ) -> int:
        if not events:
            return 0
        queued = 0
        finished = checked_at or _utc_now_iso()
        for item in events:
            ref, title, text = format_submission_score_message(
                item, competition, finished
            )
            if not ref:
                continue
            if self.enqueue_event(
                f"score::{competition}::{ref}",
                event_type="submission_score",
                title=title,
                text=text,
                competition=competition,
                created_at=finished,
                summary={
                    "ref": ref,
                    "public_score": item.get("public_score"),
                    "description": str(item.get("description") or "").strip() or "（无描述）",
                },
                require_score_switch=True,
            ):
                queued += 1
        return queued

    def enqueue_simulation_events(
        self,
        *,
        competition: str,
        events: list[dict[str, Any]],
        checked_at: Optional[str] = None,
    ) -> int:
        if not self._config.notify_on_simulation:
            return 0
        if not events:
            return 0
        queued = 0
        finished = checked_at or _utc_now_iso()
        for item in events:
            res = format_simulation_event_message(item, competition, finished)
            if res is None:
                continue
            event_id, title, text = res
            if self.enqueue_event(
                event_id,
                event_type="simulation_update",
                title=title,
                text=text,
                competition=competition,
                created_at=finished,
                summary=item,
                require_score_switch=False,
            ):
                queued += 1
        return queued

    @staticmethod
    def _enabled_channels(config: NotificationConfig) -> list[str]:
        channels: list[str] = []
        if config.wechat_enabled:
            channels.append("wechat")
        if config.webhook_enabled:
            channels.append("webhook")
        if config.email_enabled:
            channels.append("email")
        return channels

    @staticmethod
    def _format_run_message(
        log: AutoArchiveRunLog,
        items: list[AutoArchiveCheckedItem],
        competition: str,
    ) -> tuple[str, str]:
        return format_run_message(log, items, competition)

    async def _worker_loop(self) -> None:
        while True:
            event_id = await self._queue.get()
            try:
                await self._deliver_event(event_id)
            finally:
                self._queued_ids.discard(event_id)
                self._queue.task_done()

    def _record_delivery(self, event: dict, channel: str, state: str, attempts: int, error: str | None = None) -> None:
        # Keep delivery metadata only: message bodies and credentials are excluded.
        self._delivery_history.insert(0, NotificationDelivery(
            id=uuid.uuid4().hex, event_id=str(event["id"]), event=str(event.get("event", "unknown")),
            competition=str(event.get("competition", "")), channel=channel, state=state,
            attempts=attempts, recorded_at=_utc_now_iso(), error=error,
        ))
        self._delivery_history = self._delivery_history[:self.MAX_DELIVERED_EVENTS]

    async def _deliver_event(self, event_id: str) -> None:
        with self._lock:
            event = self._pending.get(event_id)
            if event is None:
                return
            event = json.loads(json.dumps(event))
            delivered = set(self._delivered.get(event_id, []))
        failures: list[str] = []
        for channel in event.get("channels", []):
            if channel in delivered:
                continue
            last_error: Exception | None = None
            for attempt in range(self.MAX_ATTEMPTS):
                try:
                    await asyncio.to_thread(self._send_channel, channel, event)
                    last_error = None
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt + 1 < self.MAX_ATTEMPTS:
                        await asyncio.sleep(2**attempt)
            if last_error is not None:
                failures.append(f"{channel}：{self._sanitize_error(last_error)}")
                with self._lock:
                    self._status.last_error = (
                        f"{channel} 通知发送失败：{self._sanitize_error(last_error)}"
                    )
                    self._record_delivery(event, channel, "failed", attempt + 1, self._sanitize_error(last_error))
                    self._save_state()
                continue
            delivered.add(channel)
            with self._lock:
                self._delivered[event_id] = sorted(delivered)
                self._status.last_sent_at = _utc_now_iso()
                self._status.last_event_id = event_id
                self._status.last_error = None
                self._record_delivery(event, channel, "sent", attempt + 1)
                self._save_state()
        if failures:
            with self._lock:
                self._status.last_error = "；".join(failures)
                self._save_state()
        expected = set(event.get("channels", []))
        if expected and expected.issubset(delivered):
            with self._lock:
                self._pending.pop(event_id, None)
                self._trim_delivered()
                self._save_state()

    def _trim_delivered(self) -> None:
        if len(self._delivered) <= self.MAX_DELIVERED_EVENTS:
            return
        overflow = len(self._delivered) - self.MAX_DELIVERED_EVENTS
        for event_id in list(self._delivered)[:overflow]:
            self._delivered.pop(event_id, None)

    def _sanitize_error(self, error: Exception) -> str:
        message = str(error)
        for key in ("webhook_url", "smtp_password"):
            secret = self._secret_store.get(key)
            if secret:
                message = message.replace(secret, "[已隐藏]")
        return message[:400]

    def _send_channel(self, channel: str, event: dict[str, Any]) -> None:
        if channel == "wechat":
            self._send_wechat(event)
            return
        if channel == "webhook":
            self._send_webhook(event)
            return
        if channel == "email":
            self._send_email(event)
            return
        raise ValueError(f"未知通知通道：{channel}")

    def _send_wechat(self, event: dict[str, Any]) -> None:
        send_wechat(event)

    def _send_webhook(self, event: dict[str, Any]) -> None:
        url = self._secret_store.get("webhook_url")
        send_webhook(event, url, self._config.webhook_format)

    def _send_email(self, event: dict[str, Any]) -> None:
        password = self._secret_store.get("smtp_password")
        send_email(event, self._config, password)

    async def send_test(self) -> NotificationTestResult:
        with self._lock:
            config = self._config.model_copy(deep=True)
        webhook_url = self._secret_store.get("webhook_url")
        smtp_password = self._secret_store.get("smtp_password")
        self._validate_config(config, webhook_url, smtp_password)
        channels = self._enabled_channels(config)
        if not channels:
            raise ValueError("请先启用至少一个通知通道。")
        created_at = _utc_now_iso()
        event = {
            "id": "test",
            "event": "notification_test",
            "title": "Kaggle Harvester：测试通知",
            "text": (
                "通知通道配置成功。后续可在自动归档、提交出分等事件触发时发送。\n"
                f"完成时间：{_format_beijing_time(created_at)}"
            ),
            "competition": "test",
            "created_at": created_at,
            "summary": {},
        }
        results: list[NotificationChannelResult] = []
        for channel in channels:
            try:
                await asyncio.to_thread(self._send_channel, channel, event)
                results.append(
                    NotificationChannelResult(
                        channel=channel, success=True, message="发送成功"
                    )
                )
            except Exception as exc:
                results.append(
                    NotificationChannelResult(
                        channel=channel,
                        success=False,
                        message=self._sanitize_error(exc),
                    )
                )
        success = bool(results) and all(item.success for item in results)
        with self._lock:
            for result in results:
                self._record_delivery(event, result.channel, "sent" if result.success else "failed", 1, None if result.success else result.message)
            self._status.last_error = (
                None
                if success
                else "；".join(
                    f"{item.channel}：{item.message}"
                    for item in results
                    if not item.success
                )
            )
            if success:
                self._status.last_sent_at = _utc_now_iso()
                self._status.last_event_id = "test"
            self._save_state()
        return NotificationTestResult(success=success, channels=results)
