from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from harvester.archiver import Archiver
from harvester.kaggle_client import KaggleClient
from harvester.models import (
    ArchiveRequest,
    ScoreDirection,
)

router = APIRouter(tags=["Archives"])


@router.post("/api/archive", response_model=dict)
async def archive_kernel(req: ArchiveRequest, request: Request):
    """Archive a kernel (download source + metadata)."""
    app = request.app
    archiver: Archiver = app.state.archiver
    client: KaggleClient = app.state.kaggle_client
    try:
        score_direction = req.score_direction
        if score_direction == ScoreDirection.AUTO:
            competition_info = await run_in_threadpool(
                client.fetch_competition_info,
                req.competition or client.competition_slug,
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
            kernel_ref=req.kernel_ref,
            version=req.version,
            score_direction=score_direction.value,
            include_outputs=req.include_outputs,
            competition=req.competition,
            overwrite=req.overwrite,
        )

        try:
            versions = await run_in_threadpool(
                client.get_kernel_versions, req.kernel_ref
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


@router.get("/api/archives", response_model=list)
async def list_archives(request: Request, competition: Optional[str] = Query(None)):
    """List all archived kernels."""
    app = request.app
    archiver: Archiver = app.state.archiver
    try:
        entries = await run_in_threadpool(
            archiver.list_archives, competition=competition
        )
        return [e.model_dump() for e in entries]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/archives/stats")
async def get_archive_stats(request: Request):
    """Get archive statistics."""
    app = request.app
    archiver: Archiver = app.state.archiver
    try:
        return archiver.get_stats()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/archives/{archive_id}")
async def get_archive(archive_id: str, request: Request):
    """Get details of a specific archived kernel."""
    app = request.app
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


@router.delete("/api/archives/{archive_id}")
async def delete_archive(archive_id: str, request: Request):
    """Delete an archived kernel."""
    app = request.app
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


@router.get("/api/archives/{archive_id}/source")
async def get_archive_source(archive_id: str, request: Request):
    """Get the source notebook file of an archived kernel."""
    app = request.app
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


@router.get("/api/archives/{archive_id}/metadata")
async def get_archive_metadata(archive_id: str, request: Request):
    """Get the metadata and input sources of an archived kernel."""
    app = request.app
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


@router.get("/api/archives/{archive_id}/files")
async def get_archive_files(archive_id: str, request: Request):
    """列出归档中的文件及大小。"""
    app = request.app
    archiver: Archiver = app.state.archiver
    try:
        return await run_in_threadpool(archiver.list_archive_files, archive_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="归档不存在")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="归档目录不存在")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/archives/{archive_id}/open-folder")
async def open_archive_folder(archive_id: str, request: Request):
    """在本机文件管理器中打开归档目录。"""
    client_host = request.client.host if request.client else ""
    allow_remote = os.environ.get("HARVESTER_ALLOW_OPEN_FOLDER", "").lower() in {
        "1", "true", "yes", "on"
    }
    if client_host not in {"127.0.0.1", "::1", "localhost"} and not allow_remote:
        raise HTTPException(status_code=403, detail="远程请求不允许打开服务器本地目录。")
    app = request.app
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


@router.post("/api/archives/{archive_id}/open-vscode")
async def open_archive_vscode(archive_id: str, request: Request):
    """在本地 VS Code 中打开该归档的代码文件或目录。"""
    import subprocess
    from pathlib import Path

    client_host = request.client.host if request.client else ""
    allow_remote = os.environ.get("HARVESTER_ALLOW_OPEN_FOLDER", "").lower() in {
        "1", "true", "yes", "on"
    }
    if client_host not in {"127.0.0.1", "::1", "localhost"} and not allow_remote:
        raise HTTPException(status_code=403, detail="远程请求不允许打开服务器本地应用。")
    app = request.app
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

    target = str(archive_path)
    if entry.source_file and Path(entry.source_file).exists():
        target = entry.source_file

    try:
        await run_in_threadpool(subprocess.Popen, f'code "{target}"', shell=True)
        return {"status": "opened_vscode", "path": target}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"无法启动 VS Code: {exc}")

