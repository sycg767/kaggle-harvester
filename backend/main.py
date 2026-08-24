from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware

# Add parent to path for local imports
sys.path.insert(0, str(Path(__file__).parent))

from harvester.archiver import Archiver
from harvester.auto_archive import AutoArchiveBusyError, AutoArchiveManager
from harvester.cache import (
    PersistentCompetitionCache,
    PersistentEnteredCompetitionsCache,
    PersistentKernelMetadataCache,
    PersistentKernelQueryCache,
    PersistentKernelScoreCache,
    PersistentSimulationEpisodeStore,
)
from harvester.kaggle_client import KaggleClient
from harvester.models import (
    ArchiveRequest,
    ArchiverConfig,
    AutoArchiveConfig,
    AutoArchiveRunDetail,
    AutoArchiveSnapshot,
    CompetitionInfo,
    EnteredCompetition,
    EnrichRequest,
    KernelListRequest,
    KernelSummary,
    NotificationConfigUpdate,
    NotificationSnapshot,
    NotificationTestResult,
    ScoredKernel,
    ScoreDirection,
SimulationClawbotTestResult,
    SimulationEpisodePageResponse,
    SimulationMonitorConfig,
    SimulationMonitorRunDetail,
    SimulationMonitorSnapshot,
    SortBy,
    SubmissionMonitorConfig,
    SubmissionMonitorRunDetail,
    SubmissionMonitorSnapshot,
    VersionScoreList,
)
from harvester.notifications import NotificationManager
from harvester.submission_monitor import (
    SubmissionMonitorBusyError,
    SubmissionMonitorManager,
)
from harvester.simulation_monitor import (
    SimulationMonitorBusyError,
    SimulationMonitorManager,
)


SCORE_INDEX_REFRESH_SECONDS = int(
    os.environ.get("SCORE_INDEX_REFRESH_SECONDS", "300")
)
LOGGER = logging.getLogger("kaggle-harvester")


class ApiKeyMiddleware(BaseHTTPMiddleware):
    """在显式配置访问密钥后保护全部 API 接口。"""

    def __init__(self, app, api_key: str = "") -> None:
        super().__init__(app)
        self.api_key = api_key.strip()

    async def dispatch(self, request: Request, call_next):
        if (
            self.api_key
            and request.url.path.startswith("/api")
            and not request.url.path.endswith("/chart.png")
            and not request.url.path.endswith("/trajectory-chart.png")
        ):
            supplied = request.headers.get("X-Harvester-Key", "")
            if not hmac.compare_digest(supplied, self.api_key):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "访问密钥无效或未提供。"},
                    headers={"X-Harvester-Auth": "required"},
                )
        return await call_next(request)


def _allowed_origins() -> list[str]:
    configured = os.environ.get("HARVESTER_ALLOWED_ORIGINS", "")
    if configured.strip():
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return ["http://127.0.0.1:5173", "http://localhost:5173"]


async def _build_kernel_snapshot(
    *,
    client: KaggleClient,
    query_cache: PersistentKernelQueryCache,
    cache_params: dict,
    valid_sort: SortBy,
    competition_slug: str,
    page_size: int,
    max_pages: int,
    include_scores: bool,
    score_limit: int,
    force_score_refresh: bool = False,
) -> list[ScoredKernel]:
    """读取最新榜单并原子替换查询快照。"""
    kernels = await run_in_threadpool(
        client.list_kernels,
        sort_by=valid_sort.value,
        page_size=page_size,
        max_pages=max_pages,
        competition=competition_slug,
    )
    scored = await run_in_threadpool(
        client.enrich_kernel_summaries,
        kernels,
        competition=competition_slug,
        score_limit=score_limit if include_scores else 0,
        force_refresh=force_score_refresh,
    )
    await run_in_threadpool(query_cache.set, cache_params, scored)
    return scored


async def _refresh_kernel_snapshot_in_background(
    *,
    task_key: str,
    cache_params: dict,
    valid_sort: SortBy,
    competition_slug: str,
    page_size: int,
    max_pages: int,
    include_scores: bool,
    score_limit: int,
) -> None:
    """后台刷新过期榜单；失败时保留旧快照。"""
    try:
        await _build_kernel_snapshot(
            client=app.state.kaggle_client,
            query_cache=app.state.kernel_query_cache,
            cache_params=cache_params,
            valid_sort=valid_sort,
            competition_slug=competition_slug,
            page_size=page_size,
            max_pages=max_pages,
            include_scores=include_scores,
            score_limit=score_limit,
            force_score_refresh=False,
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        LOGGER.exception("后台刷新 Kernel 榜单失败：%s", task_key)
    finally:
        app.state.kernel_refresh_tasks.pop(task_key, None)


def _schedule_kernel_snapshot_refresh(
    *,
    cache_params: dict,
    valid_sort: SortBy,
    competition_slug: str,
    page_size: int,
    max_pages: int,
    include_scores: bool,
    score_limit: int,
) -> bool:
    """按查询条件去重触发后台刷新，返回是否新建了任务。"""
    task_key = json.dumps(cache_params, sort_keys=True)
    existing = app.state.kernel_refresh_tasks.get(task_key)
    if existing is not None and not existing.done():
        return False

    task = asyncio.create_task(
        _refresh_kernel_snapshot_in_background(
            task_key=task_key,
            cache_params=cache_params,
            valid_sort=valid_sort,
            competition_slug=competition_slug,
            page_size=page_size,
            max_pages=max_pages,
            include_scores=include_scores,
            score_limit=score_limit,
        ),
        name=f"kernel-refresh-{task_key[:32]}",
    )
    app.state.kernel_refresh_tasks[task_key] = task
    return True


def _redact_runtime_metadata(data: dict) -> dict:
    """脱敏展示只读的运行时环境元数据。"""
    cleaned: dict = {}
    for key, value in data.items():
        lower_key = str(key).lower()
        if any(secret in lower_key for secret in ("token", "key", "secret", "password")):
            continue
        cleaned[key] = value
    return cleaned


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load .env file
    load_dotenv(Path(__file__).parent / ".env")

    competition_slug = os.environ.get(
        "KAGGLE_COMPETITION", "rogii-wellbore-geology-prediction"
    )
    harvest_root = os.environ.get("HARVEST_ROOT", "harvested_kernels")
    app.state.simulation_episode_store = PersistentSimulationEpisodeStore(harvest_root)
    app.state.kaggle_client = KaggleClient(
        competition_slug=competition_slug,
        episode_store=app.state.simulation_episode_store,
    )
    app.state.kernel_query_cache = PersistentKernelQueryCache(harvest_root)
    app.state.kernel_score_cache = PersistentKernelScoreCache(harvest_root)
    app.state.kernel_metadata_cache = PersistentKernelMetadataCache(harvest_root)
    app.state.competition_cache = PersistentCompetitionCache(harvest_root)
    app.state.entered_competitions_cache = PersistentEnteredCompetitionsCache(
        harvest_root
    )
    app.state.kernel_refresh_tasks = {}
    config = ArchiverConfig(
        harvest_root=harvest_root,
        min_free_bytes=int(
            os.environ.get("HARVESTER_MIN_FREE_BYTES", str(2 * 1024 * 1024 * 1024))
        ),
    )
    app.state.archiver = Archiver(app.state.kaggle_client, config=config)
    app.state.notifications = NotificationManager(harvest_root)
    app.state.auto_archive = AutoArchiveManager(
        app.state.kaggle_client,
        app.state.archiver,
        harvest_root=harvest_root,
        default_competition=competition_slug,
        notification_manager=app.state.notifications,
    )
    app.state.submission_monitor = SubmissionMonitorManager(
        app.state.kaggle_client,
        harvest_root=harvest_root,
        default_competition=competition_slug,
        notification_manager=app.state.notifications,
    )
    app.state.simulation_monitor = SimulationMonitorManager(
        app.state.kaggle_client,
        harvest_root=harvest_root,
        default_competition="pokemon-tcg-ai-battle",
        notification_manager=app.state.notifications,
        episode_store=app.state.simulation_episode_store,
    )
    await app.state.notifications.start()
    await app.state.auto_archive.start()
    await app.state.submission_monitor.start()
    await app.state.simulation_monitor.start()
    try:
        yield
    finally:
        refresh_tasks = list(app.state.kernel_refresh_tasks.values())
        for task in refresh_tasks:
            task.cancel()
        if refresh_tasks:
            await asyncio.gather(*refresh_tasks, return_exceptions=True)
        await app.state.simulation_monitor.stop()
        await app.state.submission_monitor.stop()
        await app.state.auto_archive.stop()
        await app.state.notifications.stop()


app = FastAPI(
    title="Kaggle Open Kernel Harvester",
    description="Scrape, browse, and archive open-source Kaggle kernels with scores.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    ApiKeyMiddleware,
    api_key=os.environ.get("HARVESTER_API_KEY", ""),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Harvester-Key"],
)


# ---------------------------------------------------------------------------
#  Health & System Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health():
    client: KaggleClient = app.state.kaggle_client
    archiver: Archiver = app.state.archiver
    query_cache: PersistentKernelQueryCache = app.state.kernel_query_cache
    score_cache: PersistentKernelScoreCache = app.state.kernel_score_cache
    metadata_cache: PersistentKernelMetadataCache = app.state.kernel_metadata_cache
    competition_cache: PersistentCompetitionCache = app.state.competition_cache
    entered_cache: PersistentEnteredCompetitionsCache = (
        app.state.entered_competitions_cache
    )
    auto_archive: AutoArchiveManager = app.state.auto_archive
    submission_monitor: SubmissionMonitorManager = app.state.submission_monitor
    simulation_monitor: SimulationMonitorManager = app.state.simulation_monitor
    notifications: NotificationManager = app.state.notifications
    readiness = client.readiness()
    ready = bool(
        readiness["kaggle_cli"]
        and (os.name != "nt" or readiness["utf8_wrapper_exists"])
    )
    return {
        "status": "ok" if ready else "degraded",
        "service": "kaggle-harvester",
        "version": app.version,
        "ready": ready,
        **readiness,
        "archive": archiver.get_stats(),
        "cache": {
            **query_cache.stats(),
            **score_cache.stats(),
            **metadata_cache.stats(),
            **competition_cache.stats(),
            **entered_cache.stats(),
        },
        "auto_archive": auto_archive.snapshot().status.model_dump(),
        "submission_monitor": submission_monitor.snapshot().status.model_dump(),
        "simulation_monitor": simulation_monitor.snapshot().status.model_dump(),
        "notifications": notifications.snapshot().status.model_dump(),
    }


# ---------------------------------------------------------------------------
#  Kernel discovery endpoints
# ---------------------------------------------------------------------------


@app.get("/api/competition", response_model=CompetitionInfo)
async def get_competition_info(
    competition: Optional[str] = Query(None, min_length=3, max_length=120),
    refresh: bool = Query(False, description="Force refresh cache"),
):
    """Fetch competition overview."""
    client: KaggleClient = app.state.kaggle_client
    competition_cache: PersistentCompetitionCache = app.state.competition_cache
    competition_slug = competition or client.competition_slug
    if not refresh:
        cached = await run_in_threadpool(
            competition_cache.get, competition_slug
        )
        if cached is not None:
            return cached
    try:
        info = await run_in_threadpool(
            client.fetch_competition_info, competition_slug, refresh
        )
        await run_in_threadpool(
            competition_cache.set, competition_slug, info
        )
        return info
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/competitions/entered", response_model=list[EnteredCompetition])
async def list_entered_competitions(
    page_size: int = Query(100, ge=1, le=200),
    refresh: bool = Query(False, description="Force refresh entered competitions cache"),
):
    """列出当前账号已参加的竞赛，供自动归档/出分监控下拉选择。

    默认读本地缓存；仅 refresh=true 时重新请求 Kaggle。
    空缓存视为未命中，避免历史解析失败留下的空列表一直挡住刷新。
    """
    client: KaggleClient = app.state.kaggle_client
    entered_cache: PersistentEnteredCompetitionsCache = (
        app.state.entered_competitions_cache
    )
    if not refresh:
        cached = await run_in_threadpool(entered_cache.get)
        if cached:
            return cached[:page_size]
    try:
        items = await run_in_threadpool(client.list_entered_competitions, page_size)
        if items:
            await run_in_threadpool(entered_cache.set, items)
        return items
    except Exception as exc:
        # 刷新失败时尽量回退到旧缓存，避免下拉空白。
        cached = await run_in_threadpool(entered_cache.get)
        if cached:
            return cached[:page_size]
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/kernels", response_model=list[ScoredKernel])
async def list_kernels(
    response: Response,
    sort_by: str = Query(
        "scoreAscending",
        description="Sort field: scoreAscending, scoreDescending, voteCount, dateCreated, dateRun, hotness",
    ),
    page_size: int = Query(100, ge=1, le=200),
    max_pages: int = Query(2, ge=1, le=50),
    competition: Optional[str] = Query(None, description="Competition slug"),
    include_scores: bool = Query(True, description="Fetch public scores"),
    score_limit: int = Query(50, ge=1, le=50),
    refresh: bool = Query(False, description="Force refresh cache"),
):
    """List kernels for the competition with LB scores."""
    client: KaggleClient = app.state.kaggle_client
    query_cache: PersistentKernelQueryCache = app.state.kernel_query_cache
    try:
        valid_sort = SortBy(sort_by)
    except ValueError:
        valid_sort = SortBy.VOTE_COUNT

    competition_slug = competition or client.competition_slug
    cache_params = {
        "competition": competition_slug,
        "include_scores": include_scores,
        "max_pages": max_pages,
        "page_size": page_size,
        "score_limit": score_limit,
        "sort_by": valid_sort.value,
    }

    cached = await run_in_threadpool(query_cache.get, cache_params)
    score_sorted = valid_sort in {
        SortBy.SCORE_ASCENDING,
        SortBy.SCORE_DESCENDING,
    }
    stale_score_index = bool(
        cached is not None
        and score_sorted
        and cached.age_seconds >= SCORE_INDEX_REFRESH_SECONDS
    )
    if cached is not None and not refresh:
        response.headers["X-Kernel-Cache-Age"] = str(int(cached.age_seconds))
        response.headers["X-Kernel-Cache-Fetched-At"] = str(
            int(cached.fetched_at)
        )
        if stale_score_index:
            scheduled = _schedule_kernel_snapshot_refresh(
                cache_params=cache_params,
                valid_sort=valid_sort,
                competition_slug=competition_slug,
                page_size=page_size,
                max_pages=max_pages,
                include_scores=include_scores,
                score_limit=score_limit,
            )
            response.headers["X-Kernel-Cache"] = "STALE"
            response.headers["X-Kernel-Refresh"] = (
                "scheduled" if scheduled else "running"
            )
        else:
            response.headers["X-Kernel-Cache"] = "HIT"
            response.headers["X-Kernel-Refresh"] = "idle"
        # 永久快照优先立即返回；任何平台检查都在后台完成。
        return cached.data

    try:
        scored = await _build_kernel_snapshot(
            client=client,
            query_cache=query_cache,
            cache_params=cache_params,
            valid_sort=valid_sort,
            competition_slug=competition_slug,
            page_size=page_size,
            max_pages=max_pages,
            include_scores=include_scores,
            score_limit=score_limit,
            force_score_refresh=refresh,
        )
        response.headers["X-Kernel-Cache"] = "MISS"
        response.headers["X-Kernel-Cache-Age"] = "0"
        response.headers["X-Kernel-Cache-Fetched-At"] = str(int(time.time()))
        response.headers["X-Kernel-Refresh"] = "idle"
        return scored
    except Exception as exc:
        if cached is not None:
            response.headers["X-Kernel-Cache"] = "FALLBACK"
            response.headers["X-Kernel-Cache-Age"] = str(int(cached.age_seconds))
            response.headers["X-Kernel-Cache-Fetched-At"] = str(
                int(cached.fetched_at)
            )
            response.headers["X-Kernel-Refresh"] = "idle"
            return cached.data
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/enrich-scores", response_model=list[ScoredKernel])
async def enrich_scores(request: EnrichRequest):
    """Enrich a list of kernels with public LB scores."""
    client: KaggleClient = app.state.kaggle_client
    competition_slug = request.competition or client.competition_slug
    try:
        return await run_in_threadpool(
            client.enrich_kernel_refs,
            request.kernels,
            competition=competition_slug,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get(
    "/api/kernel/{kernel_ref:path}/versions", response_model=VersionScoreList
)
async def get_kernel_versions(
    kernel_ref: str,
    refresh: bool = Query(False, description="Force refresh version scores"),
):
    """Get version score history for a kernel."""
    client: KaggleClient = app.state.kaggle_client
    try:
        return await run_in_threadpool(
            client.get_kernel_versions, kernel_ref, refresh=refresh
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/kernel/{kernel_ref:path}/runtime-metadata")
async def get_kernel_runtime_metadata(
    kernel_ref: str,
    version: Optional[int] = Query(None, ge=1),
):
    """读取指定 Kernel 版本的运行环境元数据（只读脱敏）。"""
    client: KaggleClient = app.state.kaggle_client
    metadata_cache: PersistentKernelMetadataCache = (
        app.state.kernel_metadata_cache
    )
    cached = await run_in_threadpool(
        metadata_cache.get, kernel_ref, version
    )
    if cached is not None:
        return _redact_runtime_metadata(cached)
    try:
        metadata = await run_in_threadpool(
            client.get_kernel_runtime_metadata, kernel_ref, version
        )
        if metadata:
            await run_in_threadpool(
                metadata_cache.set, kernel_ref, metadata, version
            )
        return _redact_runtime_metadata(metadata)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ---------------------------------------------------------------------------
#  Notification & Monitoring Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/notifications", response_model=NotificationSnapshot)
async def get_notifications():
    """读取全局通知中心配置（不含敏感密钥）。"""
    manager: NotificationManager = app.state.notifications
    return manager.snapshot()


@app.put("/api/notifications", response_model=NotificationSnapshot)
async def update_notifications(request: NotificationConfigUpdate):
    """更新通知中心配置与凭据。"""
    manager: NotificationManager = app.state.notifications
    try:
        return await manager.update_config(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.post("/api/notifications/test", response_model=NotificationTestResult)
async def test_notifications(request: Optional[NotificationConfigUpdate] = None):
    """测试当前提供/已保存的通知通道。"""
    manager: NotificationManager = app.state.notifications
    try:
        if request is not None and request.model_dump(exclude_unset=True):
            await manager.update_config(request)
        return await manager.send_test()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get("/api/auto-archive", response_model=AutoArchiveSnapshot)
async def get_auto_archive():
    """读取自动归档配置与最近状态。"""
    manager: AutoArchiveManager = app.state.auto_archive
    return manager.snapshot()


@app.put("/api/auto-archive", response_model=AutoArchiveSnapshot)
async def update_auto_archive(request: AutoArchiveConfig):
    """保存自动归档配置，并重新计算下次运行时间。"""
    manager: AutoArchiveManager = app.state.auto_archive
    try:
        return await manager.update_config(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.post("/api/auto-archive/run", response_model=AutoArchiveSnapshot)
async def run_auto_archive_now():
    """立即检查并归档低分 Kernel。"""
    manager: AutoArchiveManager = app.state.auto_archive
    try:
        return await manager.run_now(trigger="manual")
    except AutoArchiveBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get(
    "/api/auto-archive/logs/{log_id}",
    response_model=AutoArchiveRunDetail,
)
async def get_auto_archive_log(log_id: str):
    """读取一次自动归档检查的明细。"""
    manager: AutoArchiveManager = app.state.auto_archive
    try:
        detail = await run_in_threadpool(manager.get_run_detail, log_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if detail is None:
        raise HTTPException(status_code=404, detail="运行日志不存在。")
    return detail


@app.get("/api/submission-monitor", response_model=SubmissionMonitorSnapshot)
async def get_submission_monitor():
    """读取提交出分监控配置与最近状态。"""
    manager: SubmissionMonitorManager = app.state.submission_monitor
    return manager.snapshot()


@app.put("/api/submission-monitor", response_model=SubmissionMonitorSnapshot)
async def update_submission_monitor(request: SubmissionMonitorConfig):
    """保存提交出分监控配置，并重新计算下次运行时间。"""
    manager: SubmissionMonitorManager = app.state.submission_monitor
    try:
        return await manager.update_config(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.post("/api/submission-monitor/run", response_model=SubmissionMonitorSnapshot)
async def run_submission_monitor_now():
    """立即检查一次本人竞赛提交出分。"""
    manager: SubmissionMonitorManager = app.state.submission_monitor
    try:
        return await manager.run_now(trigger="manual")
    except SubmissionMonitorBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get(
    "/api/submission-monitor/logs/{log_id}",
    response_model=SubmissionMonitorRunDetail,
)
async def get_submission_monitor_log(log_id: str):
    """读取一次提交出分检查的明细。"""
    manager: SubmissionMonitorManager = app.state.submission_monitor
    try:
        detail = await run_in_threadpool(manager.get_run_detail, log_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if detail is None:
        raise HTTPException(status_code=404, detail="运行日志不存在。")
    return detail


# ---------------------------------------------------------------------------
#  Simulation Monitor Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/simulation-monitor", response_model=SimulationMonitorSnapshot)
async def get_simulation_monitor():
    """读取 Simulation 模拟对战与天梯监控状态。"""
    manager: SimulationMonitorManager = app.state.simulation_monitor
    return manager.snapshot()


@app.get(
    "/api/simulation-monitor/episodes",
    response_model=SimulationEpisodePageResponse,
)
async def get_simulation_episodes(
    submission_id: int = Query(..., description="目标提交 ID"),
    offset: int = Query(0, ge=0, description="分页偏移量"),
    limit: int = Query(50, ge=1, le=200, description="每页条数"),
):
    """按分页返回指定提交的对局流水（从内存缓存读取，不触发网络拉取）。"""
    manager: SimulationMonitorManager = app.state.simulation_monitor
    return await run_in_threadpool(
        manager.get_episodes_page, submission_id, offset, limit
    )


@app.put("/api/simulation-monitor", response_model=SimulationMonitorSnapshot)
async def update_simulation_monitor(request: SimulationMonitorConfig):
    """更新 Simulation 模拟对战监控配置。"""
    manager: SimulationMonitorManager = app.state.simulation_monitor
    try:
        return await manager.update_config(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.post("/api/simulation-monitor/run", response_model=SimulationMonitorSnapshot)
async def run_simulation_monitor_now():
    """立即检查一次 Simulation 对战战绩与天梯铜牌线。"""
    manager: SimulationMonitorManager = app.state.simulation_monitor
    try:
        return await manager.run_now(trigger="manual")
    except SimulationMonitorBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get(
    "/api/simulation-monitor/logs/{log_id}",
    response_model=SimulationMonitorRunDetail,
)
async def get_simulation_monitor_log(log_id: str):
    """读取一次 Simulation 对战检查的明细流水。"""
    manager: SimulationMonitorManager = app.state.simulation_monitor
    try:
        detail = await run_in_threadpool(manager.get_run_detail, log_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if detail is None:
        raise HTTPException(status_code=404, detail="运行日志不存在。")
    return detail


@app.post(
    "/api/simulation-monitor/clawbot/test",
    response_model=SimulationClawbotTestResult,
)
async def test_simulation_clawbot():
    """探测 OpenClaw 微信智能体网关连通性。"""
    manager: SimulationMonitorManager = app.state.simulation_monitor
    return await run_in_threadpool(manager.test_clawbot)


@app.get("/api/simulation-monitor/chart.png")
@app.get("/api/simulation-monitor/trajectory-chart.png")
async def get_simulation_trajectory_chart():
    """生成并返回评分轨迹高清折线图 (PNG)。"""
    manager: SimulationMonitorManager = app.state.simulation_monitor
    snap = manager.snapshot()
    from harvester.chart_renderer import render_trajectory_chart

    chart_bytes = await run_in_threadpool(render_trajectory_chart, snap.model_dump())
    return Response(content=chart_bytes, media_type="image/png")


@app.get("/api/simulation-monitor/submissions")
async def list_simulation_submissions(competition: Optional[str] = Query(None)):
    """读取当前竞赛下可供监控的 Agent 提交（含当前团队追踪的 Agent 以及个人提交记录）。"""
    client: KaggleClient = app.state.kaggle_client
    manager: SimulationMonitorManager = app.state.simulation_monitor
    comp = competition or "pokemon-tcg-ai-battle"

    results: list[dict[str, Any]] = []
    seen_ids: set[int] = set()

    # 1. 优先放入当前团队已配置或已在天梯战斗的 Agent
    snap = manager.snapshot()
    for idx, agent in enumerate(snap.status.agents or []):
        sub_id = int(agent.submission_id)
        if sub_id not in seen_ids:
            seen_ids.add(sub_id)
            desc_label = agent.description or f"Agent #{idx + 1}"
            if "p46" in str(sub_id) or sub_id == 55565346:
                desc_label = "Agent #1 (p46)"
            elif "p31" in str(sub_id) or sub_id == 55555162:
                desc_label = "Agent #2 (p31)"
            results.append({
                "submission_id": sub_id,
                "description": desc_label,
                "file_name": "",
                "date": "",
                "status": "complete",
                "public_score": agent.score if agent.score is not None else agent.public_score,
                "team_name": "Team Active Agent",
            })

    # 2. 拉取 Kaggle 账号名下的历史提交
    try:
        submissions = await run_in_threadpool(
            client.list_competition_submissions,
            competition=comp,
            page_size=50,
        )
        for s in submissions:
            sub_id = int(str(s.ref))
            if sub_id not in seen_ids:
                seen_ids.add(sub_id)
                results.append({
                    "submission_id": sub_id,
                    "description": s.description or s.file_name or f"提交 #{s.ref}",
                    "file_name": s.file_name,
                    "date": s.date,
                    "status": s.status,
                    "public_score": s.public_score,
                    "team_name": s.team_name,
                })
    except Exception:
        pass

    return results


# ---------------------------------------------------------------------------
#  Archive endpoints
# ---------------------------------------------------------------------------


@app.post("/api/archive", response_model=dict)
async def archive_kernel(request: ArchiveRequest):
    """Archive a kernel (download source + metadata)."""
    archiver: Archiver = app.state.archiver
    client: KaggleClient = app.state.kaggle_client
    try:
        score_direction = request.score_direction
        if score_direction == ScoreDirection.AUTO:
            competition_info = await run_in_threadpool(
                client.fetch_competition_info,
                request.competition or client.competition_slug,
            )
            if competition_info.score_direction_source == "fallback":
                raise ValueError("竞赛分数方向无法可靠识别，请明确选择 minimize 或 maximize。")
            score_direction = (
                ScoreDirection.MINIMIZE
                if competition_info.is_lower_better
                else ScoreDirection.MAXIMIZE
            )
        result = await run_in_threadpool(
            archiver.archive_kernel,
            kernel_ref=request.kernel_ref,
            version=request.version,
            score_direction=score_direction.value,
            include_outputs=request.include_outputs,
            competition=request.competition,
            overwrite=request.overwrite,
        )

        # Try to get the score for the archived version
        try:
            versions = await run_in_threadpool(
                client.get_kernel_versions, request.kernel_ref
            )
            for v in versions.versions:
                if v.version_number == result.selected_version:
                    result.public_score = v.public_lb_numeric
                    archive_id = (
                        f"{result.owner_slug}__{result.kernel_slug}__"
                        f"v{result.selected_version}"
                    )
                    archiver.update_public_score(archive_id, result.public_score)
                    break
        except Exception:
            pass

        return result.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=507, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/archives", response_model=list)
async def list_archives(competition: Optional[str] = Query(None)):
    """List all archived kernels."""
    archiver: Archiver = app.state.archiver
    try:
        entries = await run_in_threadpool(
            archiver.list_archives, competition=competition
        )
        return [e.model_dump() for e in entries]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/archives/stats")
async def get_archive_stats():
    """Get archive statistics."""
    archiver: Archiver = app.state.archiver
    try:
        return archiver.get_stats()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/archives/{archive_id}")
async def get_archive(archive_id: str):
    """Get details of a specific archived kernel."""
    archiver: Archiver = app.state.archiver
    try:
        entry = archiver.get_archive(archive_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Archive not found")
        return entry.model_dump()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/api/archives/{archive_id}")
async def delete_archive(archive_id: str):
    """Delete an archived kernel."""
    archiver: Archiver = app.state.archiver
    try:
        success = await run_in_threadpool(archiver.delete_archive, archive_id)
        if not success:
            raise HTTPException(status_code=404, detail="Archive not found")
        return {"status": "deleted", "archive_id": archive_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/archives/{archive_id}/source")
async def get_archive_source(archive_id: str):
    """Get the source notebook file of an archived kernel."""
    archiver: Archiver = app.state.archiver
    try:
        entry = archiver.get_archive(archive_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Archive not found")
        archive_path = archiver.get_archive_path(archive_id)
        if not archive_path.exists():
            raise HTTPException(status_code=404, detail="Archive files not found on disk")

        source_file = archiver.get_archive_source_path(archive_id)
        if source_file is not None:
            return FileResponse(str(source_file), filename=source_file.name)
        raise HTTPException(status_code=404, detail="归档中没有 Notebook 或脚本源文件")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/archives/{archive_id}/metadata")
async def get_archive_metadata(archive_id: str):
    """Get the metadata and input sources of an archived kernel."""
    archiver: Archiver = app.state.archiver
    try:
        entry = archiver.get_archive(archive_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Archive not found")
        archive_path = archiver.get_archive_path(archive_id)
        if not archive_path.exists():
            raise HTTPException(status_code=404, detail="Archive files not found on disk")

        return await run_in_threadpool(archiver.get_archive_metadata, archive_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/archives/{archive_id}/files")
async def get_archive_files(archive_id: str):
    """列出归档中的文件及大小。"""
    archiver: Archiver = app.state.archiver
    try:
        return await run_in_threadpool(archiver.list_archive_files, archive_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="归档不存在")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="归档目录不存在")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/archives/{archive_id}/open-folder")
async def open_archive_folder(archive_id: str, request: Request):
    """在本机文件管理器中打开归档目录。"""
    client_host = request.client.host if request.client else ""
    allow_remote = os.environ.get("HARVESTER_ALLOW_OPEN_FOLDER", "").lower() in {
        "1", "true", "yes", "on"
    }
    if client_host not in {"127.0.0.1", "::1", "localhost"} and not allow_remote:
        raise HTTPException(status_code=403, detail="远程请求不允许打开服务器本地目录。")
    archiver: Archiver = app.state.archiver
    entry = archiver.get_archive(archive_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="归档不存在")
    try:
        archive_path = archiver.get_archive_path(archive_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not archive_path.exists():
        raise HTTPException(status_code=404, detail="归档目录不存在")
    if os.name != "nt" or not hasattr(os, "startfile"):
        raise HTTPException(status_code=501, detail="当前系统不支持打开本地目录")
    await run_in_threadpool(os.startfile, str(archive_path))
    return {"status": "opened", "path": str(archive_path)}


# ---------------------------------------------------------------------------
#  Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "127.0.0.1")
    uvicorn.run("main:app", host=host, port=port, reload=False)
