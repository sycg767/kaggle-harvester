from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from .common import ScoreDirection, SortBy


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
    is_simulation: bool = False
    tags: list[str] = Field(default_factory=list)


class EnteredCompetition(BaseModel):
    """当前账号已参加的竞赛摘要。"""

    id: str
    title: str = ""
    category: str = ""
    deadline: Optional[str] = None
    reward: Optional[str] = None
    team_count: Optional[int] = None
    is_simulation: bool = False
    tags: list[str] = Field(default_factory=list)
