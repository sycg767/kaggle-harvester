from __future__ import annotations

import os
import re
import smtplib
import socket
import ssl
import urllib.parse
from email.message import EmailMessage
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

from ..models import NotificationConfig


def detect_webhook_format(url: str) -> Optional[str]:
    """根据 Webhook URL 推断机器人服务类型；无法识别时返回 None。"""
    raw = (url or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if not host:
        return None
    if host.endswith("feishu.cn") or host.endswith("larksuite.com"):
        return "feishu"
    if host.endswith("dingtalk.com"):
        return "dingtalk"
    if host.endswith("qyapi.weixin.qq.com") or (
        host.endswith("weixin.qq.com") and "webhook" in (parsed.path or "").lower()
    ):
        return "wecom"
    if host.endswith("hooks.slack.com") or host == "hooks.slack.com":
        return "slack"
    if host == "ntfy.sh" or host.endswith(".ntfy.sh"):
        return "ntfy"
    return None


def maybe_fix_webhook_format(format_name: str, webhook_url: str) -> str:
    """generic 且 URL 能识别时自动升级为具体服务，避免飞书仍按通用 JSON 发送。"""
    if format_name != "generic":
        return format_name
    detected = detect_webhook_format(webhook_url)
    return detected or format_name


def validate_webhook_url(value: str) -> None:
    parsed = urlparse(value)
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Webhook 地址必须是有效的 HTTP(S) URL。")
    if parsed.scheme != "https" and parsed.hostname not in local_hosts:
        raise ValueError("外部 Webhook 必须使用 HTTPS。")
    if parsed.username or parsed.password:
        raise ValueError("Webhook 地址不支持 URL 用户名或密码。")


def valid_email(value: str) -> bool:
    return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value))


def send_wechat(event: dict[str, Any]) -> None:
    title = str(event.get("title") or "Kaggle Harvester")
    text = str(event.get("text") or "")
    message_text = f"{title}\n\n{text}".strip()

    gateway_url = os.getenv("OPENCLAW_GATEWAY_URL", "http://127.0.0.1:18789").rstrip("/")
    endpoints = [
        f"{gateway_url}/api/notify",
        f"{gateway_url}/api/message",
        f"{gateway_url}/api/v1/message",
        f"{gateway_url}/api/send",
    ]
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer kaggle-harvester-claw-token",
        "X-OpenClaw-Token": "kaggle-harvester-claw-token",
    }
    apikey = os.getenv("OPENCLAW_LLM_API_KEY")
    if apikey:
        headers["X-API-Key"] = apikey

    payload = {
        "content": message_text,
        "text": message_text,
        "message": message_text,
        "target": "last_active_user",
        "channel": "openclaw-weixin",
    }

    sent = False
    for endpoint in endpoints:
        try:
            with httpx.Client(timeout=3.0) as client:
                res = client.post(
                    endpoint,
                    json=payload,
                    headers=headers,
                )
                if res.status_code in [200, 201, 204]:
                    sent = True
                    break
        except Exception:
            continue

    if not sent:
        try:
            parsed = urllib.parse.urlparse(gateway_url)
            host = parsed.hostname or "127.0.0.1"
            port = parsed.port or 18789
            with socket.create_connection((host, port), timeout=0.5):
                return
        except Exception:
            pass
        if event.get("event") == "notification_test":
            raise RuntimeError(f"未能连通 OpenClaw 网关 ({gateway_url})，端口 18789 未响应或未启动")


def send_webhook(event: dict[str, Any], url: str, webhook_format: str) -> None:
    if not url:
        raise RuntimeError("Webhook 地址尚未配置。")
    validate_webhook_url(url)
    title = str(event.get("title") or "Kaggle Harvester")
    text = str(event.get("text") or "")
    format_name = maybe_fix_webhook_format(webhook_format, url)
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


def send_email(
    event: dict[str, Any],
    config: NotificationConfig,
    password: str,
) -> None:
    message = EmailMessage()
    message["Subject"] = str(event.get("title") or "Kaggle Harvester 通知")
    message["From"] = config.smtp_from
    message["To"] = ", ".join(config.smtp_to)
    message.set_content(str(event.get("text") or ""))
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
