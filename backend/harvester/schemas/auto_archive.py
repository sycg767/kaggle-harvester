from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .common import ScoreDirection, _normalize_competition_slugs


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
