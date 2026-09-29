from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .common import _normalize_competition_slugs, get_default_competition


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
        default_factory=lambda: [get_default_competition()],
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
