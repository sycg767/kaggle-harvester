from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

# Add parent to path for local imports
sys.path.insert(0, str(Path(__file__).parent))

from harvester.archiver import Archiver
from harvester.auto_archive import AutoArchiveBusyError, AutoArchiveManager
from harvester.cache import (
    PersistentCompetitionCache,
    PersistentKernelMetadataCache,
    PersistentKernelQueryCache,
    PersistentKernelScoreCache,
)
from harvester.kaggle_client import KaggleClient
from harvester.models import (
    ArchiveRequest,
    ArchiverConfig,
    AutoArchiveConfig,
    AutoArchiveRunDetail,
    AutoArchiveSnapshot,
    CompetitionInfo,
    EnrichRequest,
    KernelListRequest,
    KernelSummary,
    NotificationConfigUpdate,
    NotificationSnapshot,
    NotificationTestResult,
    ScoredKernel,
    ScoreDirection,
    SortBy,
    VersionScoreList,
)
from harvester.notifications import NotificationManager


SCORE_INDEX_REFRESH_SECONDS = int(
    os.environ.get("SCORE_INDEX_REFRESH_SECONDS", "300")
)
LOGGER = logging.getLogger("kaggle-harvester")


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
    """对同一查询去重调度后台刷新，返回是否新建任务。"""
    task_key = json.dumps(cache_params, sort_keys=True, separators=(",", ":"))
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
        name=f"kernel-refresh:{competition_slug}:{valid_sort.value}",
    )
    app.state.kernel_refresh_tasks[task_key] = task
    return True

# ---------------------------------------------------------------------------
#  App lifecycle
# ---------------------------------------------------------------------------

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    kaggle_token = os.environ.get("KAGGLE_API_TOKEN", "")
    competition_slug = os.environ.get(
        "KAGGLE_COMPETITION", KaggleClient.COMPETITION_SLUG
    )
    harvest_root = os.environ.get(
        "HARVEST_ROOT",
        str(Path(__file__).parent.parent / "harvested_kernels"),
    )
    app.state.kernel_query_cache = PersistentKernelQueryCache(harvest_root)
    app.state.kernel_score_cache = PersistentKernelScoreCache(harvest_root)
    app.state.kernel_metadata_cache = PersistentKernelMetadataCache(harvest_root)
    app.state.competition_cache = PersistentCompetitionCache(harvest_root)
    app.state.kernel_refresh_tasks = {}
    app.state.kaggle_client = KaggleClient(
        kaggle_token=kaggle_token,
        competition_slug=competition_slug,
        score_cache=app.state.kernel_score_cache,
        metadata_cache=app.state.kernel_metadata_cache,
    )
    config = ArchiverConfig(harvest_root=harvest_root)
    app.state.archiver = Archiver(app.state.kaggle_client, config=config)
    app.state.notifications = NotificationManager(harvest_root)
    app.state.auto_archive = AutoArchiveManager(
        app.state.kaggle_client,
        app.state.archiver,
        harvest_root=harvest_root,
        default_competition=competition_slug,
        notification_manager=app.state.notifications,
    )
    await app.state.notifications.start()
    await app.state.auto_archive.start()
    try:
        yield
    finally:
        refresh_tasks = list(app.state.kernel_refresh_tasks.values())
        for task in refresh_tasks:
            task.cancel()
        if refresh_tasks:
            await asyncio.gather(*refresh_tasks, return_exceptions=True)
        await app.state.auto_archive.stop()
        await app.state.notifications.stop()


app = FastAPI(
    title="Kaggle Open Kernel Harvester",
    description="Scrape, browse, and archive open-source Kaggle kernels with scores.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
#  Kernel discovery endpoints
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health():
    client: KaggleClient = app.state.kaggle_client
    archiver: Archiver = app.state.archiver
    query_cache: PersistentKernelQueryCache = app.state.kernel_query_cache
    score_cache: PersistentKernelScoreCache = app.state.kernel_score_cache
    metadata_cache: PersistentKernelMetadataCache = app.state.kernel_metadata_cache
    competition_cache: PersistentCompetitionCache = app.state.competition_cache
    auto_archive: AutoArchiveManager = app.state.auto_archive
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
        },
        "auto_archive": auto_archive.snapshot().status.model_dump(),
        "notifications": notifications.snapshot().status.model_dump(),
    }


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
            # 用户点击“刷新分数榜”时，除了重建榜单索引，还要强制重拉公开分。
            force_score_refresh=refresh,
        )
        response.headers["X-Kernel-Cache"] = (
            "REFRESH"
            if refresh
            else "MISS"
        )
        response.headers["X-Kernel-Cache-Age"] = "0"
        response.headers["X-Kernel-Refresh"] = "idle"

        return scored
    except Exception as exc:
        if cached is not None:
            response.headers["X-Kernel-Cache"] = "STALE"
            response.headers["X-Kernel-Refresh"] = "failed"
            response.headers["X-Kernel-Cache-Age"] = str(
                int(cached.age_seconds)
            )
            response.headers["X-Kernel-Cache-Fetched-At"] = str(
                int(cached.fetched_at)
            )
            return cached.data
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/kernels/enrich", response_model=list[ScoredKernel])
async def enrich_kernels(request: EnrichRequest):
    """Enrich a list of kernel refs with LB scores."""
    client: KaggleClient = app.state.kaggle_client
    try:
        scored = await run_in_threadpool(
            client.enrich_scores,
            request.kernels,
            competition=request.competition,
        )
        return scored
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/kernel/{owner}/{slug}/versions", response_model=VersionScoreList)
async def get_kernel_versions(
    owner: str,
    slug: str,
    refresh: bool = Query(False, description="Check for new versions"),
):
    """Get version history with scores for a kernel."""
    client: KaggleClient = app.state.kaggle_client
    try:
        ref = f"{owner}/{slug}"
        versions = await run_in_threadpool(
            client.get_kernel_versions, ref, refresh=refresh
        )
        return versions
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ---------------------------------------------------------------------------
#  Archive endpoints
# ---------------------------------------------------------------------------


@app.get("/api/auto-archive", response_model=AutoArchiveSnapshot)
async def get_auto_archive():
    """读取自动归档配置和最近一次运行状态。"""
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
    """立即执行一次检查；即使定时开关关闭也可手动运行。"""
    manager: AutoArchiveManager = app.state.auto_archive
    try:
        return await manager.run_now(trigger="manual")
    except AutoArchiveBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get(
    "/api/auto-archive/logs/{log_id}", response_model=AutoArchiveRunDetail
)
async def get_auto_archive_log(log_id: str):
    """读取一次自动归档检查的完整 Kernel 明细。"""
    manager: AutoArchiveManager = app.state.auto_archive
    try:
        detail = await run_in_threadpool(manager.get_run_detail, log_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if detail is None:
        raise HTTPException(status_code=404, detail="运行日志不存在。")
    return detail


@app.get("/api/notifications", response_model=NotificationSnapshot)
async def get_notifications():
    """读取通知配置、凭据状态和后台发送状态。"""
    manager: NotificationManager = app.state.notifications
    return manager.snapshot()


@app.put("/api/notifications", response_model=NotificationSnapshot)
async def update_notifications(request: NotificationConfigUpdate):
    """保存通知配置；敏感字段由加密凭据存储单独处理。"""
    manager: NotificationManager = app.state.notifications
    try:
        return await manager.update_config(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"通知凭据保存失败：{exc}")


@app.post("/api/notifications/test", response_model=NotificationTestResult)
async def test_notifications():
    """向已启用的通知通道发送一条测试消息。"""
    manager: NotificationManager = app.state.notifications
    try:
        return await manager.send_test()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


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
async def open_archive_folder(archive_id: str):
    """在本机文件管理器中打开归档目录。"""
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
