from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class NotificationConfig(BaseModel):
    """全局通知中心的非敏感配置（与自动归档解耦）。"""

    notify_on_archive: bool = True
    notify_on_failure: bool = True
    notify_on_score: bool = True
    notify_on_simulation: bool = True
    wechat_enabled: bool = False
    webhook_enabled: bool = False
    webhook_format: Literal[
        "generic", "slack", "feishu", "dingtalk", "wecom", "ntfy"
    ] = "feishu"
    email_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_security: Literal["starttls", "ssl", "none"] = "starttls"
    smtp_username: str = ""
    smtp_from: str = ""
    smtp_to: list[str] = Field(default_factory=list, max_length=20)


class NotificationConfigUpdate(BaseModel):
    """通知配置更新请求；未提供的字段保持服务端现值。

    敏感字段只在用户主动填写时传输；未填写时保留已保存凭据。
    """

    notify_on_archive: Optional[bool] = None
    notify_on_failure: Optional[bool] = None
    notify_on_score: Optional[bool] = None
    notify_on_simulation: Optional[bool] = None
    wechat_enabled: Optional[bool] = None
    webhook_enabled: Optional[bool] = None
    webhook_format: Optional[
        Literal["generic", "slack", "feishu", "dingtalk", "wecom", "ntfy"]
    ] = None
    email_enabled: Optional[bool] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = Field(default=None, ge=1, le=65535)
    smtp_security: Optional[Literal["starttls", "ssl", "none"]] = None
    smtp_username: Optional[str] = None
    smtp_from: Optional[str] = None
    smtp_to: Optional[list[str]] = Field(default=None, max_length=20)
    webhook_url: Optional[str] = Field(default=None, max_length=2000)
    smtp_password: Optional[str] = Field(default=None, max_length=1000)
    clear_webhook_url: bool = False
    clear_smtp_password: bool = False


class NotificationConfigView(NotificationConfig):
    """返回给前端的通知配置，不包含敏感凭据。"""

    webhook_configured: bool = False
    smtp_password_configured: bool = False
    secret_storage: Literal["windows_dpapi", "environment", "file", "session"] = "session"


class NotificationStatus(BaseModel):
    """通知队列的运行状态。"""

    worker_alive: bool = False
    last_sent_at: Optional[str] = None
    last_error: Optional[str] = None
    last_event_id: Optional[str] = None
    pending_count: int = 0


class NotificationDelivery(BaseModel):
    id: str
    event_id: str
    event: str
    competition: str = ""
    channel: str
    state: Literal["queued", "sent", "failed"]
    attempts: int = 0
    recorded_at: str
    error: Optional[str] = None


class NotificationSnapshot(BaseModel):
    """通知配置、凭据状态和发送状态。"""

    config: NotificationConfigView
    status: NotificationStatus
    deliveries: list[NotificationDelivery] = Field(default_factory=list)


class NotificationChannelResult(BaseModel):
    """单个通知通道的测试结果。"""

    channel: str
    success: bool
    message: str


class NotificationTestResult(BaseModel):
    """通知测试结果。"""

    success: bool
    channels: list[NotificationChannelResult] = Field(default_factory=list)
