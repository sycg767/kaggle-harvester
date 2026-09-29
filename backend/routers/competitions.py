from __future__ import annotations

import os
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool

from harvester.cache import (
    PersistentActiveCompetitionStore,
    PersistentCompetitionCache,
    PersistentEnteredCompetitionsCache,
    resolve_active_competition,
)
from harvester.kaggle_client import KaggleClient
from harvester.models import (
    ActiveCompetitionInfo,
    CompetitionInfo,
    EnteredCompetition,
    SetActiveCompetitionRequest,
)

router = APIRouter(tags=["Competitions"])


@router.get("/api/competition", response_model=CompetitionInfo)
async def get_competition_info(
    request: Request,
    competition: Optional[str] = Query(None, min_length=3, max_length=120),
    refresh: bool = Query(False, description="Force refresh cache"),
):
    """Fetch competition overview."""
    app = request.app
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
        cached = await run_in_threadpool(
            competition_cache.get, competition_slug, None, True
        )
        if cached is not None:
            return cached
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/competitions/entered", response_model=list[EnteredCompetition])
async def list_entered_competitions(
    request: Request,
    page_size: int = Query(100, ge=1, le=200),
    refresh: bool = Query(False, description="Force refresh entered competitions cache"),
):
    """列出当前账号已参加的竞赛，供自动归档/出分监控下拉选择。"""
    app = request.app
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
        cached = await run_in_threadpool(entered_cache.get, None, True)
        if cached:
            return cached[:page_size]
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/active-competition", response_model=ActiveCompetitionInfo)
async def get_active_competition(request: Request):
    """获取当前默认/主攻竞赛及来源（pinned / auto / env / fallback）。"""
    app = request.app
    store: PersistentActiveCompetitionStore = app.state.active_competition_store
    entered_cache: PersistentEnteredCompetitionsCache = (
        app.state.entered_competitions_cache
    )
    slug, source = resolve_active_competition(
        store=store,
        entered_cache=entered_cache,
        env_default=os.environ.get("KAGGLE_COMPETITION"),
    )
    return {
        "competition": slug,
        "source": source,
        "is_pinned": source == "pinned",
        "pinned_competition": store.get(),
    }


@router.post("/api/active-competition", response_model=ActiveCompetitionInfo)
async def set_active_competition(payload: SetActiveCompetitionRequest, request: Request):
    """设置或清除全站默认/主攻竞赛。"""
    app = request.app
    store: PersistentActiveCompetitionStore = app.state.active_competition_store
    client: Optional[KaggleClient] = getattr(app.state, "kaggle_client", None)
    target = (payload.competition or "").strip()
    if not target:
        store.clear()
    else:
        if len(target) < 3 or not re.match(r"^[a-zA-Z0-9_-]+$", target):
            raise HTTPException(
                status_code=400,
                detail="竞赛标识无效，仅支持字母、数字、短横线及下划线。",
            )
        store.set(target)
        if client is not None:
            client.competition_slug = target

    entered_cache: PersistentEnteredCompetitionsCache = (
        app.state.entered_competitions_cache
    )
    slug, source = resolve_active_competition(
        store=store,
        entered_cache=entered_cache,
        env_default=os.environ.get("KAGGLE_COMPETITION"),
    )
    return {
        "competition": slug,
        "source": source,
        "is_pinned": source == "pinned",
        "pinned_competition": store.get(),
    }


@router.delete("/api/active-competition", response_model=ActiveCompetitionInfo)
async def delete_active_competition(request: Request):
    """清除手动指定的主攻赛事，恢复智能自动选择默认赛事。"""
    app = request.app
    store: PersistentActiveCompetitionStore = app.state.active_competition_store
    store.clear()
    entered_cache: PersistentEnteredCompetitionsCache = (
        app.state.entered_competitions_cache
    )
    slug, source = resolve_active_competition(
        store=store,
        entered_cache=entered_cache,
        env_default=os.environ.get("KAGGLE_COMPETITION"),
    )
    client: Optional[KaggleClient] = getattr(app.state, "kaggle_client", None)
    if client is not None:
        client.competition_slug = slug
    return {
        "competition": slug,
        "source": source,
        "is_pinned": False,
        "pinned_competition": None,
    }
