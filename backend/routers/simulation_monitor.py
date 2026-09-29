from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from harvester.kaggle_client import KaggleClient
from harvester.models import (
    SimulationClawbotTestResult,
    SimulationEpisodePageResponse,
    SimulationMonitorConfig,
    SimulationMonitorRunDetail,
    SimulationMonitorSnapshot,
)
from harvester.simulation_monitor import (
    SimulationMonitorBusyError,
    SimulationMonitorManager,
)

router = APIRouter(tags=["SimulationMonitor"])


@router.get("/api/simulation-monitor", response_model=SimulationMonitorSnapshot)
async def get_simulation_monitor(request: Request):
    """读取 Simulation 模拟对战与天梯监控状态。"""
    manager: SimulationMonitorManager = request.app.state.simulation_monitor
    return manager.snapshot()


@router.get(
    "/api/simulation-monitor/episodes",
    response_model=SimulationEpisodePageResponse,
)
async def get_simulation_episodes(
    request: Request,
    submission_id: int = Query(..., description="目标提交 ID"),
    offset: int = Query(0, ge=0, description="分页偏移量"),
    limit: int = Query(50, ge=1, le=200, description="每页条数"),
):
    """按分页返回指定提交的对局流水（从内存缓存读取，不触发网络拉取）。"""
    manager: SimulationMonitorManager = request.app.state.simulation_monitor
    return await run_in_threadpool(
        manager.get_episodes_page, submission_id, offset, limit
    )


@router.put("/api/simulation-monitor", response_model=SimulationMonitorSnapshot)
async def update_simulation_monitor(
    config: SimulationMonitorConfig, request: Request
):
    """更新 Simulation 模拟对战监控配置。"""
    manager: SimulationMonitorManager = request.app.state.simulation_monitor
    try:
        return await manager.update_config(config)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post(
    "/api/simulation-monitor/run", response_model=SimulationMonitorSnapshot
)
async def run_simulation_monitor_now(request: Request):
    """立即检查一次 Simulation 对战战绩与天梯铜牌线。"""
    manager: SimulationMonitorManager = request.app.state.simulation_monitor
    try:
        return await manager.run_now(trigger="manual")
    except SimulationMonitorBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get(
    "/api/simulation-monitor/logs/{log_id}",
    response_model=SimulationMonitorRunDetail,
)
async def get_simulation_monitor_log(log_id: str, request: Request):
    """读取一次 Simulation 对战检查的明细流水。"""
    manager: SimulationMonitorManager = request.app.state.simulation_monitor
    try:
        detail = await run_in_threadpool(manager.get_run_detail, log_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if detail is None:
        raise HTTPException(status_code=404, detail="运行日志不存在。")
    return detail


@router.post(
    "/api/simulation-monitor/clawbot/test",
    response_model=SimulationClawbotTestResult,
)
async def test_simulation_clawbot(request: Request):
    """探测 OpenClaw 微信智能体网关连通性。"""
    manager: SimulationMonitorManager = request.app.state.simulation_monitor
    return await run_in_threadpool(manager.test_clawbot)


@router.get("/api/simulation-monitor/chart.png")
@router.get("/api/simulation-monitor/trajectory-chart.png")
async def get_simulation_trajectory_chart(request: Request):
    """生成并返回评分轨迹高清折线图 (PNG)。"""
    manager: SimulationMonitorManager = request.app.state.simulation_monitor
    snap = manager.snapshot()
    from harvester.chart_renderer import render_trajectory_chart

    chart_bytes = await run_in_threadpool(
        render_trajectory_chart, snap.model_dump()
    )
    return Response(content=chart_bytes, media_type="image/png")


@router.get("/api/simulation-monitor/submissions")
async def list_simulation_submissions(
    request: Request, competition: Optional[str] = Query(None)
):
    """读取当前竞赛下可供监控的 Agent 提交（含当前团队追踪的 Agent 以及个人提交记录）。"""
    client: KaggleClient = request.app.state.kaggle_client
    manager: SimulationMonitorManager = request.app.state.simulation_monitor
    comp = competition or "pokemon-tcg-ai-battle"

    results: list[dict[str, Any]] = []
    seen_ids: set[int] = set()

    snap = manager.snapshot()
    if snap.config.competition == comp:
        for idx, agent in enumerate(snap.status.agents or []):
            sub_id = int(agent.submission_id)
            if sub_id not in seen_ids:
                seen_ids.add(sub_id)
                desc_label = agent.description or f"Agent #{idx + 1}"
                results.append({
                    "submission_id": sub_id,
                    "description": desc_label,
                    "file_name": "",
                    "date": "",
                    "status": "complete",
                    "public_score": agent.score if agent.score is not None else agent.public_score,
                    "team_name": "Team Active Agent",
                })

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
