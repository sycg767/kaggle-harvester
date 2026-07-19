from __future__ import annotations

import asyncio
import base64
import ctypes
import ctypes.wintypes
import json
import os
import re
import smtplib
import ssl
import threading
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

from .models import (
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


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


BEIJING_TIMEZONE = timezone(timedelta(hours=8), name="北京时间")


def _format_beijing_time(value: str) -> str:
    """把内部保存的 ISO 时间转换为通知中使用的北京时间。"""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(BEIJING_TIMEZONE).strftime(
            "%Y-%m-%d %H:%M:%S（北京时间）"
        )
    except (TypeError, ValueError):
        return value


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _dpapi_transform(data: bytes, protect: bool) -> bytes:
    if os.name != "nt":
        raise RuntimeError("当前系统不支持 Windows DPAPI。")
    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    input_blob = _DataBlob(
        len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))
    )
    output_blob = _DataBlob()
    flags = 0x01  # CRYPTPROTECT_UI_FORBIDDEN
    if protect:
        success = ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(input_blob),
            "Kaggle Harvester Notifications",
            None,
            None,
            None,
            flags,
            ctypes.byref(output_blob),
        )
    else:
        success = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(input_blob),
            None,
            None,
            None,
            None,
            flags,
            ctypes.byref(output_blob),
        )
    if not success:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output_blob.pbData)


class NotificationSecretStore:
    """在 Windows 上使用当前用户 DPAPI 保存通知凭据。"""

    ENVIRONMENT_KEYS = {
        "webhook_url": "HARVESTER_NOTIFICATION_WEBHOOK_URL",
        "smtp_password": "HARVESTER_NOTIFICATION_SMTP_PASSWORD",
    }

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.RLock()
        self._values: dict[str, str] = {}
        self._load()

    @property
    def storage_mode(self) -> str:
        if any(os.environ.get(name) for name in self.ENVIRONMENT_KEYS.values()):
            return "environment"
        return "windows_dpapi" if os.name == "nt" else "session"

    def _load(self) -> None:
        if os.name != "nt" or not self._path.exists():
            return
        try:
            encrypted = base64.b64decode(self._path.read_bytes(), validate=True)
            payload = json.loads(_dpapi_transform(encrypted, False))
            if isinstance(payload, dict):
                self._values = {
                    str(key): str(value)
                    for key, value in payload.items()
                    if value
                }
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            self._values = {}

    def get(self, key: str) -> str:
        environment_name = self.ENVIRONMENT_KEYS.get(key)
        if environment_name and os.environ.get(environment_name):
            return os.environ[environment_name]
        with self._lock:
            return self._values.get(key, "")

    def update(self, values: dict[str, Optional[str]]) -> None:
        with self._lock:
            for key, value in values.items():
                if value:
                    self._values[key] = value
                else:
                    self._values.pop(key, None)
            if os.name != "nt":
                return
            self._path.parent.mkdir(parents=True, exist_ok=True)
            encrypted = _dpapi_transform(
                json.dumps(self._values, ensure_ascii=False).encode("utf-8"),
                True,
            )
            temp_path = self._path.with_suffix(".tmp")
            temp_path.write_bytes(base64.b64encode(encrypted))
            temp_path.replace(self._path)


class NotificationManager:
    """持久化通知配置，并在后台可靠发送自动归档事件。"""

    STATE_VERSION = 1
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
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._queued_ids: set[str] = set()
        self._task: asyncio.Task[None] | None = None
        self._load_state()

    def _load_state(self) -> None:
        if not self._state_path.exists():
            return
        try:
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
            if data.get("version") != self.STATE_VERSION:
                return
            self._config = NotificationConfig(**data.get("config", {}))
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
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            self._config = NotificationConfig()
            self._status = NotificationStatus(
                last_error="通知配置无法读取，已恢复为关闭状态。"
            )
            self._pending = {}
            self._delivered = {}
        self._status.worker_alive = False
        self._status.pending_count = len(self._pending)

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
            }
            temp_path = self._state_path.with_suffix(".tmp")
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp_path.replace(self._state_path)

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
        return NotificationSnapshot(config=config, status=status)

    @staticmethod
    def _validate_webhook_url(value: str) -> None:
        parsed = urlparse(value)
        local_hosts = {"localhost", "127.0.0.1", "::1"}
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("Webhook 地址必须是有效的 HTTP(S) URL。")
        if parsed.scheme != "https" and parsed.hostname not in local_hosts:
            raise ValueError("外部 Webhook 必须使用 HTTPS。")
        if parsed.username or parsed.password:
            raise ValueError("Webhook 地址不支持 URL 用户名或密码。")

    @staticmethod
    def _valid_email(value: str) -> bool:
        return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value))

    def _validate_config(
        self,
        config: NotificationConfig,
        webhook_url: str,
        smtp_password: str,
    ) -> None:
        if (config.webhook_enabled or config.email_enabled) and not (
            config.notify_on_archive or config.notify_on_failure
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
        recipients = list(
            dict.fromkeys(item.strip().lower() for item in request.smtp_to if item.strip())
        )
        config = NotificationConfig(
            **request.model_dump(
                exclude={
                    "webhook_url",
                    "smtp_password",
                    "clear_webhook_url",
                    "clear_smtp_password",
                    "smtp_to",
                    "smtp_host",
                    "smtp_username",
                    "smtp_from",
                }
            ),
            smtp_host=request.smtp_host.strip(),
            smtp_username=request.smtp_username.strip(),
            smtp_from=request.smtp_from.strip(),
            smtp_to=recipients,
        )
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
            self._save_state()
        self._queue_event(log.id)
        return True

    @staticmethod
    def _enabled_channels(config: NotificationConfig) -> list[str]:
        channels: list[str] = []
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
        title = (
            "Kaggle Harvester：自动归档有失败"
            if log.failed_count > 0 or log.outcome == "failed"
            else "Kaggle Harvester：发现并归档新 Kernel"
        )
        lines = [
            f"竞赛：{competition}",
            f"完成时间：{_format_beijing_time(log.finished_at)}",
            (
                "结果："
                f"检查 {log.checked_count}，命中 {log.matched_count}，"
                f"新增 {log.archived_count}，跳过 {log.skipped_count}，"
                f"失败 {log.failed_count}"
            ),
        ]
        archived = [item for item in items if item.action == "archived"][:10]
        failed = [item for item in items if item.action == "failed"][:10]
        if archived:
            lines.append("归档明细：")
            lines.extend(
                f"- {item.ref} · {item.public_score:.4f}"
                + (f" · v{item.version_number}" if item.version_number else "")
                for item in archived
                if item.public_score is not None
            )
        if failed:
            lines.append("失败明细：")
            lines.extend(
                f"- {item.ref} · {(item.error or '未知错误')[:200]}"
                for item in failed
            )
        if log.error:
            lines.append(f"运行错误：{log.error[:500]}")
        return title, "\n".join(lines)

    async def _worker_loop(self) -> None:
        while True:
            event_id = await self._queue.get()
            try:
                await self._deliver_event(event_id)
            finally:
                self._queued_ids.discard(event_id)
                self._queue.task_done()

    async def _deliver_event(self, event_id: str) -> None:
        with self._lock:
            event = self._pending.get(event_id)
            if event is None:
                return
            event = json.loads(json.dumps(event))
            delivered = set(self._delivered.get(event_id, []))
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
                with self._lock:
                    self._status.last_error = (
                        f"{channel} 通知发送失败：{self._sanitize_error(last_error)}"
                    )
                    self._save_state()
                continue
            delivered.add(channel)
            with self._lock:
                self._delivered[event_id] = sorted(delivered)
                self._status.last_sent_at = _utc_now_iso()
                self._status.last_event_id = event_id
                self._status.last_error = None
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
        if channel == "webhook":
            self._send_webhook(event)
            return
        if channel == "email":
            self._send_email(event)
            return
        raise ValueError(f"未知通知通道：{channel}")

    def _send_webhook(self, event: dict[str, Any]) -> None:
        url = self._secret_store.get("webhook_url")
        if not url:
            raise RuntimeError("Webhook 地址尚未配置。")
        self._validate_webhook_url(url)
        title = str(event.get("title") or "Kaggle Harvester")
        text = str(event.get("text") or "")
        format_name = self._config.webhook_format
        headers: dict[str, str] = {}
        content: bytes | None = None
        if format_name == "slack":
            payload: Any = {"text": f"*{title}*\n{text}"}
        elif format_name == "feishu":
            payload = {"msg_type": "text", "content": {"text": f"{title}\n{text}"}}
        elif format_name == "dingtalk":
            payload = {"msgtype": "text", "text": {"content": f"{title}\n{text}"}}
        elif format_name == "wecom":
            payload = {"msgtype": "text", "text": {"content": f"{title}\n{text}"}}
        elif format_name == "ntfy":
            payload = None
            content = f"{title}\n\n{text}".encode("utf-8")
            headers = {"Content-Type": "text/plain; charset=utf-8"}
        else:
            payload = {
                "event": event.get("event"),
                "title": title,
                "text": text,
                "competition": event.get("competition"),
                "created_at": event.get("created_at"),
                "summary": event.get("summary"),
            }
        with httpx.Client(timeout=15.0, follow_redirects=False) as client:
            response = client.post(
                url,
                json=payload if content is None else None,
                content=content,
                headers=headers,
            )
        if response.status_code < 200 or response.status_code >= 300:
            raise RuntimeError(f"Webhook 返回 HTTP {response.status_code}。")

    def _send_email(self, event: dict[str, Any]) -> None:
        config = self._config
        message = EmailMessage()
        message["Subject"] = str(event.get("title") or "Kaggle Harvester 通知")
        message["From"] = config.smtp_from
        message["To"] = ", ".join(config.smtp_to)
        message.set_content(str(event.get("text") or ""))
        password = self._secret_store.get("smtp_password")
        if config.smtp_security == "ssl":
            smtp: smtplib.SMTP = smtplib.SMTP_SSL(
                config.smtp_host,
                config.smtp_port,
                timeout=20,
                context=ssl.create_default_context(),
            )
        else:
            smtp = smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=20)
        try:
            if config.smtp_security == "starttls":
                smtp.ehlo()
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            if config.smtp_username:
                smtp.login(config.smtp_username, password)
            smtp.send_message(message)
        finally:
            try:
                smtp.quit()
            except (OSError, smtplib.SMTPException):
                smtp.close()

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
                "通知通道配置成功。后续仅在有新增归档或检查失败时发送。\n"
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
