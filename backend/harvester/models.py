from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class SortBy(str, Enum):
    """Sort options for kernel listing."""
    SCORE_ASCENDING = "scoreAscending"
    SCORE_DESCENDING = "scoreDescending"
    HOTNESS = "hotness"
    DATE_CREATED = "dateCreated"
    DATE_RUN = "dateRun"
    VOTE_COUNT = "voteCount"


class ScoreDirection(str, Enum):
    """Direction for best-score selection."""
    AUTO = "auto"
    MINIMIZE = "minimize"
    MAXIMIZE = "maximize"


class KernelSummary(BaseModel):
    """A single kernel entry from the Kaggle kernels list."""
    ref: str = Field(description="Owner/kernel-slug")
    title: str
    author: str
    last_run_time: Optional[str] = None
    vote_count: int = 0
    total_votes: int = 0
    kernel_type: str = ""
    category: str = ""
    competition: Optional[str] = None
    is_competition_kernel: bool = False


class ScoredKernel(BaseModel):
    """Kernel with public leaderboard score."""
    ref: str
    title: str
    author: str
    public_score: Optional[float] = None
    public_score_display: Optional[str] = None
    vote_count: int = 0
    total_votes: int = 0
    is_competition_kernel: bool = False
    kernel_type: str = ""
    category: str = ""
    last_run_time: Optional[str] = None
    competition: Optional[str] = None


class VersionInfo(BaseModel):
    """Information about a specific kernel version."""
    version_number: int
    title: str
    status: str
    date_created: str
    public_lb: Optional[str] = None
    public_lb_numeric: Optional[float] = None
    script_version_id: Optional[int] = None


class VersionScoreList(BaseModel):
    """Score history for a kernel."""
    owner_slug: str
    kernel_slug: str
    versions: list[VersionInfo]


class ArchiveResult(BaseModel):
    """Result of archiving a kernel."""
    owner_slug: str
    kernel_slug: str
    selected_version: int
    script_version_id: int
    source_path: str
    metadata: dict[str, Any]
    public_score: Optional[float] = None
    versions: list[VersionInfo] = Field(default_factory=list)
    already_existed: bool = False


class ArchiveEntry(BaseModel):
    """An entry in the local archive."""
    id: str = Field(description="Unique archive ID")
    ref: str
    title: str
    author: str
    archived_at: str
    path: str
    version_number: int
    public_score: Optional[float] = None
    competition: Optional[str] = None
    source_file: Optional[str] = None
    file_count: int = 0
    size_bytes: int = 0
    include_outputs: bool = False


class ArchiverConfig(BaseModel):
    """Configuration for the archiver."""
    harvest_root: str = Field(
        default="harvested_kernels",
        description="Root directory for storing harvested kernels"
    )
    max_concurrent: int = Field(
        default=3,
        description="Maximum concurrent archive operations"
    )


class KernelListRequest(BaseModel):
    """Request to list kernels for a competition."""
    competition_id: str
    sort_by: SortBy = SortBy.VOTE_COUNT
    page_size: int = 100
    max_pages: int = 10


class ArchiveRequest(BaseModel):
    """Request to archive a kernel."""
    kernel_ref: str
    output_dir: Optional[str] = None
    version: Optional[int] = None
    score_direction: ScoreDirection = ScoreDirection.AUTO
    include_outputs: bool = False
    competition: Optional[str] = None
    overwrite: bool = False


class EnrichRequest(BaseModel):
    """Request to enrich a list of kernels with scores."""
    kernels: list[str] = Field(description="List of kernel refs (owner/slug)")
    competition: Optional[str] = None


class CompetitionInfo(BaseModel):
    """Competition overview information."""
    id: str
    title: str
    category: str
    deadline: Optional[str] = None
    reward: Optional[str] = None
    team_count: Optional[int] = None
    kernel_count: Optional[int] = None
    evaluation_metric: Optional[str] = None
    description: Optional[str] = None
    is_lower_better: bool = True
    score_direction_source: Literal[
        "api", "leaderboard", "metric", "fallback"
    ] = "fallback"


class AutoArchiveConfig(BaseModel):
    """定时检查并归档低分 Kernel 的持久化配置。"""

    enabled: bool = False
    competition: str = Field(
        default="rogii-wellbore-geology-prediction",
        min_length=3,
        max_length=120,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9-]*$",
    )
    score_threshold: Optional[float] = None
    interval_minutes: int = Field(default=30, ge=1, le=1440)
    include_outputs: bool = True
    score_direction: ScoreDirection = ScoreDirection.AUTO


class NotificationConfig(BaseModel):
    """自动归档通知的非敏感配置。"""

    notify_on_archive: bool = True
    notify_on_failure: bool = True
    webhook_enabled: bool = False
    webhook_format: Literal[
        "generic", "slack", "feishu", "dingtalk", "wecom", "ntfy"
    ] = "generic"
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


class NotificationSnapshot(BaseModel):
    """通知配置、凭据状态和发送状态。"""

    config: NotificationConfigView
    status: NotificationStatus


class NotificationChannelResult(BaseModel):
    """单个通知通道的测试结果。"""

    channel: str
    success: bool
    message: str


class NotificationTestResult(BaseModel):
    """通知测试结果。"""

    success: bool
    channels: list[NotificationChannelResult] = Field(default_factory=list)


class AutoArchiveItemResult(BaseModel):
    """单个 Kernel 在最近一次自动检查中的处理结果。"""

    ref: str
    public_score: float
    status: Literal["archived", "skipped", "failed"]
    version_number: Optional[int] = None
    error: Optional[str] = None


class AutoArchiveStatus(BaseModel):
    """自动归档任务的当前状态和最近一次结果。"""

    running: bool = False
    scheduler_alive: bool = False
    service_started_at: Optional[str] = None
    scheduler_heartbeat_at: Optional[str] = None
    last_checked_at: Optional[str] = None
    next_run_at: Optional[str] = None
    last_error: Optional[str] = None
    checked_count: int = 0
    matched_count: int = 0
    archived_count: int = 0
    skipped_count: int = 0
    failed_count: int = 0
    effective_score_direction: Optional[
        Literal["minimize", "maximize"]
    ] = None
    score_direction_source: Optional[str] = None
    recent_results: list[AutoArchiveItemResult] = Field(default_factory=list)


class AutoArchiveRunLog(BaseModel):
    """一次自动归档检查的持久化运行日志。"""

    id: str
    trigger: Literal["scheduled", "manual"]
    outcome: Literal["success", "partial", "failed"]
    started_at: str
    finished_at: str
    duration_seconds: float = Field(ge=0)
    checked_count: int = 0
    matched_count: int = 0
    archived_count: int = 0
    skipped_count: int = 0
    failed_count: int = 0
    error: Optional[str] = None
    details_available: bool = False


class AutoArchiveCheckedItem(BaseModel):
    """一次检查中某个 Kernel 的公开信息与处理结果。"""

    ref: str
    title: str
    author: str
    public_score: Optional[float] = None
    last_run_time: Optional[str] = None
    matched: bool = False
    action: Literal["not_matched", "archived", "skipped", "failed"]
    version_number: Optional[int] = None
    error: Optional[str] = None


class AutoArchiveRunDetail(BaseModel):
    """一次自动归档检查的完整明细。"""

    log: AutoArchiveRunLog
    items: list[AutoArchiveCheckedItem] = Field(default_factory=list)


class AutoArchiveSnapshot(BaseModel):
    """自动归档配置与运行状态。"""

    config: AutoArchiveConfig
    status: AutoArchiveStatus
    logs: list[AutoArchiveRunLog] = Field(default_factory=list)
