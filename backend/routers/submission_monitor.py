from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from harvester.models import (
    SubmissionMonitorConfig,
    SubmissionMonitorRunDetail,
    SubmissionMonitorSnapshot,
)
from harvester.submission_monitor import (
    SubmissionMonitorBusyError,
    SubmissionMonitorManager,
)

router = APIRouter(tags=["SubmissionMonitor"])


@router.get("/api/submission-monitor", response_model=SubmissionMonitorSnapshot)
async def get_submission_monitor(request: Request):
    """读取提交出分监控配置与最近状态。"""
    manager: SubmissionMonitorManager = request.app.state.submission_monitor
    return manager.snapshot()


@router.put("/api/submission-monitor", response_model=SubmissionMonitorSnapshot)
async def update_submission_monitor(config: SubmissionMonitorConfig, request: Request):
    """保存提交出分监控配置，并重新计算下次运行时间。"""
    manager: SubmissionMonitorManager = request.app.state.submission_monitor
    try:
        return await manager.update_config(config)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/api/submission-monitor/run", response_model=SubmissionMonitorSnapshot)
async def run_submission_monitor_now(request: Request):
    """立即检查一次本人竞赛提交出分。"""
    manager: SubmissionMonitorManager = request.app.state.submission_monitor
    try:
        return await manager.run_now(trigger="manual")
    except SubmissionMonitorBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get(
    "/api/submission-monitor/logs/{log_id}",
    response_model=SubmissionMonitorRunDetail,
)
async def get_submission_monitor_log(log_id: str, request: Request):
    """读取一次提交出分检查的明细。"""
    manager: SubmissionMonitorManager = request.app.state.submission_monitor
    try:
        detail = await run_in_threadpool(manager.get_run_detail, log_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if detail is None:
        raise HTTPException(status_code=404, detail="运行日志不存在。")
    return detail
