"""
Notification routes.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from harvester.models import (
    NotificationConfigUpdate,
    NotificationSnapshot,
    NotificationTestResult,
)
from harvester.notifications import NotificationManager

router = APIRouter(tags=["notifications"])


@router.get("/api/notifications", response_model=NotificationSnapshot)
async def get_notifications(request: Request):
    """读取全局通知中心配置（不含敏感密钥）。"""
    manager: NotificationManager = request.app.state.notifications
    return manager.snapshot()


@router.put("/api/notifications", response_model=NotificationSnapshot)
async def update_notifications(
    update_req: NotificationConfigUpdate,
    request: Request,
):
    """更新通知中心配置与凭据。"""
    manager: NotificationManager = request.app.state.notifications
    try:
        return await manager.update_config(update_req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/api/notifications/test", response_model=NotificationTestResult)
async def test_notifications(
    request: Request,
    test_req: Optional[NotificationConfigUpdate] = None,
):
    """测试当前提供/已保存的通知通道。"""
    manager: NotificationManager = request.app.state.notifications
    try:
        if test_req is not None and test_req.model_dump(exclude_unset=True):
            await manager.update_config(test_req)
        return await manager.send_test()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
