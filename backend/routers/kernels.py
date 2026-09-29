from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from harvester.cache import (
    PersistentKernelMetadataCache,
    PersistentKernelQueryCache,
)
from harvester.kaggle_client import KaggleClient
from harvester.models import (
    EnrichRequest,
    ScoredKernel,
    SortBy,
    VersionScoreList,
)

router = APIRouter(tags=["Kernels"])
LOGGER = logging.getLogger("kaggle-harvester")
SCORE_INDEX_REFRESH_SECONDS = int(
    os.environ.get("SCORE_INDEX_REFRESH_SECONDS", "300")
)


def _redact_runtime_metadata(data: dict) -> dict:
    """脱敏展示只读的运行时环境元数据。"""
    cleaned: dict = {}
    for key, value in data.items():
        lower_key = str(key).lower()
        if any(secret in lower_key for secret in ("token", "key", "secret", "password")):
            continue
        cleaned[key] = value
    return cleaned


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
    app,
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


def _get_app():
    import sys
    if "main" in sys.modules:
        return sys.modules["main"].app
    import main
    return main.app


def _schedule_kernel_snapshot_refresh(
    *,
    cache_params: dict,
    valid_sort: SortBy,
    competition_slug: str,
    page_size: int,
    max_pages: int,
    include_scores: bool,
    score_limit: int,
    app=None,
) -> bool:
    """按查询条件去重触发后台刷新，返回是否新建了任务。"""
    if app is None:
        app = _get_app()
    task_key = json.dumps(cache_params, sort_keys=True)
    existing = app.state.kernel_refresh_tasks.get(task_key)
    if existing is not None and not existing.done():
        return False

    task = asyncio.create_task(
        _refresh_kernel_snapshot_in_background(
            app=app,
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


def _get_score_index_refresh_seconds() -> int:
    import sys
    if "main" in sys.modules and hasattr(sys.modules["main"], "SCORE_INDEX_REFRESH_SECONDS"):
        return getattr(sys.modules["main"], "SCORE_INDEX_REFRESH_SECONDS")
    return SCORE_INDEX_REFRESH_SECONDS


@router.get("/api/kernels", response_model=list[ScoredKernel])
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
    app = _get_app()
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
    refresh_seconds = _get_score_index_refresh_seconds()
    stale_score_index = bool(
        cached is not None
        and score_sorted
        and cached.age_seconds >= refresh_seconds
    )
    if cached is not None and not refresh:
        response.headers["X-Kernel-Cache-Age"] = str(int(cached.age_seconds))
        response.headers["X-Kernel-Cache-Fetched-At"] = str(
            int(cached.fetched_at)
        )
        if stale_score_index:
            scheduled = _schedule_kernel_snapshot_refresh(
                app=app,
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


@router.post("/api/enrich-scores", response_model=list[ScoredKernel])
async def enrich_scores(req: EnrichRequest, request: Request):
    """Enrich a list of kernels with public LB scores."""
    app = request.app
    client: KaggleClient = app.state.kaggle_client
    competition_slug = req.competition or client.competition_slug
    try:
        return await run_in_threadpool(
            client.enrich_kernel_refs,
            req.kernels,
            competition=competition_slug,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get(
    "/api/kernel/{kernel_ref:path}/versions", response_model=VersionScoreList
)
async def get_kernel_versions(
    kernel_ref: str,
    request: Request,
    refresh: bool = Query(False, description="Force refresh version scores"),
):
    """Get version score history for a kernel."""
    app = request.app
    client: KaggleClient = app.state.kaggle_client
    try:
        return await run_in_threadpool(
            client.get_kernel_versions, kernel_ref, refresh=refresh
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/kernel/{kernel_ref:path}/runtime-metadata")
async def get_kernel_runtime_metadata(
    kernel_ref: str,
    request: Request,
    version: Optional[int] = Query(None, ge=1),
):
    """读取指定 Kernel 版本的运行环境元数据（只读脱敏）。"""
    app = request.app
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
