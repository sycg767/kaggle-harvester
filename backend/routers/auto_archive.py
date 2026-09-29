from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from harvester.auto_archive import AutoArchiveBusyError, AutoArchiveManager
from harvester.models import (
    AutoArchiveConfig,
    AutoArchiveRunDetail,
    AutoArchiveSnapshot,
)

router = APIRouter(tags=["AutoArchive"])


@router.get("/api/auto-archive", response_model=AutoArchiveSnapshot)
async def get_auto_archive(request: Request):
    """读取自动归档配置与最近状态。"""
    manager: AutoArchiveManager = request.app.state.auto_archive
    return manager.snapshot()


@router.put("/api/auto-archive", response_model=AutoArchiveSnapshot)
async def update_auto_archive(config: AutoArchiveConfig, request: Request):
    """保存自动归档配置，并重新计算下次运行时间。"""
    manager: AutoArchiveManager = request.app.state.auto_archive
    try:
        return await manager.update_config(config)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/api/auto-archive/run", response_model=AutoArchiveSnapshot)
async def run_auto_archive_now(request: Request):
    """立即检查并归档低分 Kernel。"""
    manager: AutoArchiveManager = request.app.state.auto_archive
    try:
        return await manager.run_now(trigger="manual")
    except AutoArchiveBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get(
    "/api/auto-archive/logs/{log_id}",
    response_model=AutoArchiveRunDetail,
)
async def get_auto_archive_log(log_id: str, request: Request):
    """读取一次自动归档检查的明细。"""
    manager: AutoArchiveManager = request.app.state.auto_archive
    try:
        detail = await run_in_threadpool(manager.get_run_detail, log_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if detail is None:
        raise HTTPException(status_code=404, detail="运行日志不存在。")
    return detail
