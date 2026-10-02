from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


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
    is_system_check: bool = False
    reward: Optional[float] = None
    score_delta: Optional[float] = None
    opponent_score: Optional[float] = None
    replay_url: str = ""


class SimulationRatingPoint(BaseModel):
    """单场对局结算后的评分轨迹点。"""

    episode_id: int
    game_number: int
    timestamp: Optional[str] = None
    score: float
    score_delta: Optional[float] = None
    is_system_check: bool = False
    result: Literal["win", "loss", "tie", "unknown"] = "unknown"


class SimulationAgentStats(BaseModel):
    """单个参赛代理的聚合战绩与天梯排位。"""

    submission_id: int
    alias: Optional[str] = None
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
    system_checks: int = 0
    win_rate: float = 0.0
    recent_episodes: list[SimulationEpisode] = Field(default_factory=list)
    rating_trajectory: list[SimulationRatingPoint] = Field(default_factory=list)
    bronze_gap_score: Optional[float] = None
    bronze_gap_rank: Optional[int] = None
    tier_cushion_score: Optional[float] = None
    next_tier_gap_score: Optional[float] = None
    next_tier_name: Optional[Literal["gold", "silver", "bronze"]] = None
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
    alias: Optional[str] = None
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
    submission_aliases: dict[str, str] = Field(default_factory=dict)
    bronze_percentile: float = Field(default=0.10, ge=0.01, le=0.50)
    notify_on_new_matches: bool = True
    notify_on_new_episodes: Optional[bool] = None
    notify_on_medal_change: bool = True


class SimulationClawbotStatus(BaseModel):
    """微信 ClawBot 智能体运行状态。"""

    enabled: bool = False
    is_online: bool = False
    gateway_ok: Optional[bool] = None
    gateway_reachable: Optional[bool] = None
    wechat_configured: Optional[bool] = None
    wechat_running: Optional[bool] = None
    business_api_ok: Optional[bool] = None
    delivery_configured: Optional[bool] = None
    checked_at: Optional[str] = None
    status_source: str = "unknown"
    configured: bool = False
    provider: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None
    gateway_url: Optional[str] = None
    account_id: Optional[str] = None
    error: Optional[str] = None
    updated_at: Optional[str] = None


class SimulationClawbotTestCandidate(BaseModel):
    target: str
    reachable: bool
    latency_ms: Optional[float] = None
    detail: str


class SimulationClawbotTestResult(BaseModel):
    success: bool
    message: str
    active_url: Optional[str] = None
    latency_ms: Optional[float] = None
    configured: bool = False
    config_file_found: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    candidates: list[SimulationClawbotTestCandidate] = Field(default_factory=list)
    status: Optional[SimulationClawbotStatus] = None


class SimulationMonitorStatus(BaseModel):
    """Simulation 监控器的实时运行状态。"""

    running: bool = False
    scheduler_alive: bool = False
    enabled: bool = False
    service_started_at: Optional[str] = None
    scheduler_heartbeat_at: Optional[str] = None
    last_checked_at: Optional[str] = None
    last_success_at: Optional[str] = None
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


class SimulationEpisodePageResponse(BaseModel):
    """单个提交对局流水的分页响应。"""

    submission_id: int
    total: int = 0
    offset: int = 0
    limit: int = 0
    episodes: list[SimulationEpisode] = Field(default_factory=list)


class SimulationMonitorSnapshot(BaseModel):
    """Simulation 监控配置与状态快照。"""

    config: SimulationMonitorConfig
    status: SimulationMonitorStatus
    logs: list[SimulationMonitorRunLog] = Field(default_factory=list)


class SimulationArenaSnapshot(BaseModel):
    """Read-only view of one competition, independent of the active monitor."""

    competition: str
    monitored_competition: str
    source: Literal["current", "history", "empty"]
    captured_at: Optional[str] = None
    run_id: Optional[str] = None
    warning: Optional[str] = None
    status: SimulationMonitorStatus


class SimulationHistoryPage(BaseModel):
    logs: list[SimulationMonitorRunLog] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 20
    warning: Optional[str] = None
