from __future__ import annotations

import re
from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


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
    min_free_bytes: int = Field(
        default=2 * 1024 * 1024 * 1024,
        ge=0,
        description="Minimum free disk space required before a download",
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


COMPETITION_SLUG_PATTERN = r"^[a-zA-Z0-9][a-zA-Z0-9-]{2,119}$"


def _normalize_competition_slugs(values: list[Any]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in values:
        slug = str(raw or "").strip()
        if not slug or slug in seen:
            continue
        if not re.fullmatch(COMPETITION_SLUG_PATTERN, slug):
            raise ValueError(f"竞赛标识无效：{slug}")
        seen.add(slug)
        cleaned.append(slug)
    return cleaned


class EnteredCompetition(BaseModel):
    """当前账号已参加的竞赛摘要。"""

    id: str
    title: str = ""
    category: str = ""
    deadline: Optional[str] = None
    reward: Optional[str] = None
    team_count: Optional[int] = None


class AutoArchiveConfig(BaseModel):
    """定时检查并归档低分 Kernel 的持久化配置（共享设置 + 多竞赛）。"""

    enabled: bool = False
    competitions: list[str] = Field(
        default_factory=lambda: ["rogii-wellbore-geology-prediction"],
        min_length=1,
        max_length=30,
    )
    # 每个竞赛独立阈值；启用时每个 competitions 项都必须有对应值。
    score_thresholds: dict[str, float] = Field(default_factory=dict)
    interval_minutes: int = Field(default=30, ge=1, le=1440)
    include_outputs: bool = False
    score_direction: ScoreDirection = ScoreDirection.AUTO

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_single_competition(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        payload = dict(data)
        competitions = payload.get("competitions")
        if not competitions:
            legacy = payload.get("competition")
            if legacy:
                payload["competitions"] = [legacy]
        if "score_thresholds" not in payload or payload.get("score_thresholds") is None:
            thresholds: dict[str, float] = {}
            legacy_threshold = payload.get("score_threshold")
            comps = payload.get("competitions") or []
            if legacy_threshold is not None and comps:
                try:
                    value = float(legacy_threshold)
                except (TypeError, ValueError):
                    value = None
                if value is not None and len(comps) == 1:
                    thresholds[str(comps[0])] = value
            payload["score_thresholds"] = thresholds
        return payload

    @field_validator("competitions", mode="before")
    @classmethod
    def _validate_competitions(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            raise ValueError("competitions 必须是列表。")
        cleaned = _normalize_competition_slugs(value)
        if not cleaned:
            raise ValueError("至少选择一个竞赛。")
        return cleaned

    @field_validator("score_thresholds", mode="before")
    @classmethod
    def _validate_score_thresholds(cls, value: Any) -> dict[str, float]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise ValueError("score_thresholds 必须是对象。")
        cleaned: dict[str, float] = {}
        for key, raw in value.items():
            slug = str(key).strip()
            if not slug:
                continue
            cleaned[slug] = float(raw)
        return cleaned

    def threshold_for(self, competition: str) -> float | None:
        if competition in self.score_thresholds:
            return float(self.score_thresholds[competition])
        return None


class NotificationConfig(BaseModel):
    """全局通知中心的非敏感配置（与自动归档解耦）。"""

    notify_on_archive: bool = True
    notify_on_failure: bool = True
    notify_on_score: bool = True
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

    competition: str = ""
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
    competitions_checked: list[str] = Field(default_factory=list)
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
    competitions_checked: list[str] = Field(default_factory=list)
    error: Optional[str] = None
    details_available: bool = False


class AutoArchiveCheckedItem(BaseModel):
    """一次检查中某个 Kernel 的公开信息与处理结果。"""

    competition: str = ""
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


class CompetitionSubmission(BaseModel):
    """竞赛提交记录（用于出分监控）。"""

    ref: str
    file_name: str = ""
    date: Optional[str] = None
    description: str = ""
    status: str = ""
    error_description: str = ""
    submitted_by: str = ""
    submitted_by_ref: str = ""
    team_name: str = ""
    public_score: Optional[float] = None
    public_score_display: Optional[str] = None
    private_score: Optional[float] = None
    private_score_display: Optional[str] = None


class SubmissionMonitorConfig(BaseModel):
    """定时检查本人竞赛提交出分的配置（共享设置 + 多竞赛）。"""

    enabled: bool = False
    competitions: list[str] = Field(
        default_factory=lambda: ["rogii-wellbore-geology-prediction"],
        min_length=1,
        max_length=30,
    )
    interval_minutes: int = Field(default=5, ge=1, le=1440)
    # 本人每日提交很少；默认只拉最近少量记录即可覆盖待出分窗口。
    page_size: int = Field(default=10, ge=1, le=50)
    description_prefix: str = Field(default="", max_length=200)

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_single_competition(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        payload = dict(data)
        if not payload.get("competitions"):
            legacy = payload.get("competition")
            if legacy:
                payload["competitions"] = [legacy]
        return payload

    @field_validator("competitions", mode="before")
    @classmethod
    def _validate_competitions(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            raise ValueError("competitions 必须是列表。")
        cleaned = _normalize_competition_slugs(value)
        if not cleaned:
            raise ValueError("至少选择一个竞赛。")
        return cleaned


class SubmissionScoreEvent(BaseModel):
    """一次新出分事件。"""

    competition: str = ""
    ref: str
    description: str = ""
    public_score: float
    public_score_display: str = ""
    status: str = ""
    date: Optional[str] = None
    # 监控器首次观察到该提交已有 Public LB 分数的时间，并非 Kaggle 实际出分时间。
    scored_at: Optional[str] = None
    submitted_by: str = ""
    submitted_by_ref: str = ""
    team_name: str = ""
    previous_public_score: Optional[float] = None


class SubmissionMonitorItem(BaseModel):
    """最近一次检查中看到的提交摘要。"""

    competition: str = ""
    ref: str
    description: str = ""
    status: str = ""
    error_description: str = ""
    submitted_by: str = ""
    submitted_by_ref: str = ""
    team_name: str = ""
    public_score: Optional[float] = None
    public_score_display: Optional[str] = None
    date: Optional[str] = None
    # 监控器首次观察到该提交已有 Public LB 分数的时间，并非 Kaggle 实际出分时间。
    scored_at: Optional[str] = None
    state: Literal["pending", "scored", "failed"] = "pending"
    watched: bool = True
    newly_scored: bool = False


class SubmissionMonitorStatus(BaseModel):
    """提交出分监控的运行状态。"""

    running: bool = False
    scheduler_alive: bool = False
    service_started_at: Optional[str] = None
    scheduler_heartbeat_at: Optional[str] = None
    last_checked_at: Optional[str] = None
    next_run_at: Optional[str] = None
    last_error: Optional[str] = None
    checked_count: int = 0
    pending_count: int = 0
    scored_count: int = 0
    failed_count: int = 0
    newly_scored_count: int = 0
    competitions_checked: list[str] = Field(default_factory=list)
    recent_events: list[SubmissionScoreEvent] = Field(default_factory=list)
    recent_items: list[SubmissionMonitorItem] = Field(default_factory=list)


class SubmissionMonitorRunLog(BaseModel):
    """一次提交出分检查的汇总。"""

    id: str
    trigger: Literal["scheduled", "manual"]
    outcome: Literal["success", "partial", "failed"]
    started_at: str
    finished_at: str
    duration_seconds: float = Field(ge=0)
    checked_count: int = 0
    pending_count: int = 0
    scored_count: int = 0
    failed_count: int = 0
    newly_scored_count: int = 0
    competitions_checked: list[str] = Field(default_factory=list)
    error: Optional[str] = None
    details_available: bool = False


class SubmissionMonitorRunDetail(BaseModel):
    """一次提交出分检查的明细。"""

    log: SubmissionMonitorRunLog
    items: list[SubmissionMonitorItem] = Field(default_factory=list)


class SubmissionMonitorSnapshot(BaseModel):
    """提交出分监控配置与状态。"""

    config: SubmissionMonitorConfig
    status: SubmissionMonitorStatus
    logs: list[SubmissionMonitorRunLog] = Field(default_factory=list)


# ---------------------------------------------------------------------------
#  Simulation (Agent Battle & Leaderboard) Models
# ---------------------------------------------------------------------------


class SimulationEpisodeAgent(BaseModel):
    """单场对局中的一个 Agent 参赛信息。"""

    submission_id: int
    team_id: Optional[int] = None
    team_name: str = ""
    reward: Optional[float] = None
    index: int = 0
    state: Optional[str] = None


class SimulationEpisode(BaseModel):
    """单场对局详情。"""

    id: int
    create_time: Optional[str] = None
    end_time: Optional[str] = None
    duration_seconds: Optional[float] = None
    state: str = ""
    type: str = ""
    agents: list[SimulationEpisodeAgent] = Field(default_factory=list)
    my_agent_index: int = 0
    my_submission_id: int
    my_team_name: str = ""
    opponent_team_name: str = ""
    opponent_team_id: Optional[int] = None
    opponent_submission_id: Optional[int] = None
    result: Literal["win", "loss", "tie", "unknown"] = "unknown"
    reward: Optional[float] = None
    score_delta: Optional[float] = None
    opponent_score: Optional[float] = None
    replay_url: str = ""


class SimulationAgentStats(BaseModel):
    """单个参赛代理的聚合战绩与天梯排位。"""

    submission_id: int
    file_name: str = ""
    description: str = ""
    team_name: str = ""
    date: Optional[str] = None
    status: str = ""
    public_score: Optional[float] = None
    score: Optional[float] = None
    public_score_display: Optional[str] = None
    rank: Optional[int] = None
    total_episodes: int = 0
    wins: int = 0
    losses: int = 0
    ties: int = 0
    win_rate: float = 0.0
    recent_episodes: list[SimulationEpisode] = Field(default_factory=list)
    bronze_gap_score: Optional[float] = None
    bronze_gap_rank: Optional[int] = None
    medal_tier: Literal["gold", "silver", "bronze", "none", "unknown"] = "unknown"
    last_updated: Optional[str] = None


class SimulationMedalThresholds(BaseModel):
    """天梯排行榜奖牌线分界数据。"""

    total_teams: int = 0
    gold_cutoff_rank: int = 0
    gold_cutoff_score: Optional[float] = None
    silver_cutoff_rank: int = 0
    silver_cutoff_score: Optional[float] = None
    bronze_cutoff_rank: int = 0
    bronze_cutoff_score: Optional[float] = None
    bronze_percentile: float = 0.10
    updated_at: Optional[str] = None


class SimulationHistoryPoint(BaseModel):
    """一次历史检查点的关键指标快照（用于走势分析）。"""

    timestamp: str
    submission_id: int
    score: Optional[float] = None
    rank: Optional[int] = None
    total_episodes: int = 0
    wins: int = 0
    losses: int = 0
    ties: int = 0
    win_rate: float = 0.0
    bronze_gap_score: Optional[float] = None
    bronze_cutoff_score: Optional[float] = None


class SimulationMonitorConfig(BaseModel):
    """Simulation 模拟对战与天梯监控配置。"""

    enabled: bool = False
    competition: str = Field(default="pokemon-tcg-ai-battle")
    interval_minutes: int = Field(default=10, ge=1, le=1440)
    target_submission_ids: list[int] = Field(default_factory=list, max_length=10)
    submission_ids: list[int] = Field(default_factory=list, max_length=10)
    bronze_percentile: float = Field(default=0.10, ge=0.01, le=0.50)
    notify_on_new_matches: bool = True
    notify_on_new_episodes: bool = True
    notify_on_medal_change: bool = True


class SimulationClawbotStatus(BaseModel):
    """微信 ClawBot 智能体运行状态。"""

    enabled: bool = False
    configured: bool = False
    provider: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None
    account_id: Optional[str] = None
    updated_at: Optional[str] = None


class SimulationMonitorStatus(BaseModel):
    """Simulation 监控器的实时运行状态。"""

    running: bool = False
    scheduler_alive: bool = False
    service_started_at: Optional[str] = None
    scheduler_heartbeat_at: Optional[str] = None
    last_checked_at: Optional[str] = None
    next_run_at: Optional[str] = None
    last_error: Optional[str] = None
    competition: str = "pokemon-tcg-ai-battle"
    agents: list[SimulationAgentStats] = Field(default_factory=list)
    thresholds: Optional[SimulationMedalThresholds] = None
    medal_thresholds: Optional[SimulationMedalThresholds] = None
    history: list[SimulationHistoryPoint] = Field(default_factory=list)
    history_points: list[SimulationHistoryPoint] = Field(default_factory=list)
    total_tracked_episodes: int = 0
    new_episodes_this_run: int = 0
    new_episodes_count: int = 0
    clawbot: Optional[SimulationClawbotStatus] = None


class SimulationMonitorRunLog(BaseModel):
    """一次对战检查的持久化运行日志。"""

    id: str
    trigger: Literal["scheduled", "manual"]
    outcome: Literal["success", "partial", "failed"]
    started_at: str
    finished_at: str
    duration_seconds: float = Field(ge=0)
    competition: str = "pokemon-tcg-ai-battle"
    agent_count: int = 0
    total_episodes_found: int = 0
    new_episodes_found: int = 0
    total_teams: int = 0
    bronze_cutoff_score: Optional[float] = None
    agents_summary: list[dict[str, Any]] = Field(default_factory=list)
    new_episodes_count: int = 0
    error: Optional[str] = None
    details_available: bool = False


class SimulationMonitorRunDetail(BaseModel):
    """一次对战检查的完整明细（包含全部代理详细对局）。"""

    log: SimulationMonitorRunLog
    agents: list[SimulationAgentStats] = Field(default_factory=list)
    thresholds: Optional[SimulationMedalThresholds] = None
    medal_thresholds: Optional[SimulationMedalThresholds] = None


class SimulationMonitorSnapshot(BaseModel):
    """Simulation 监控配置与状态快照。"""

    config: SimulationMonitorConfig
    status: SimulationMonitorStatus
    logs: list[SimulationMonitorRunLog] = Field(default_factory=list)
