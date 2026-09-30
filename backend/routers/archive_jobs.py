from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from harvester.models import ArchiveRequest

router = APIRouter(tags=['Archive jobs'])


class CreateJob(BaseModel):
    items: list[ArchiveRequest] = Field(min_length=1, max_length=100)
    request_id: str | None = Field(default=None, max_length=128)


@router.post('/api/archive-jobs')
async def create_job(body: CreateJob, request: Request):
    try:
        return request.app.state.archive_jobs.create(body.items, body.request_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    except OSError:
        raise HTTPException(507, '任务无法保存，请检查服务器存储空间及目录权限；任务尚未开始。')


@router.get('/api/archive-jobs')
async def list_jobs(request: Request, competition: str | None = None, limit: int = Query(20, ge=1, le=100)):
    """Return all active jobs in FIFO order plus up to limit recent terminal jobs."""
    return request.app.state.archive_jobs.list(competition, limit)


@router.get('/api/archive-jobs/{job_id}')
async def get_job(job_id: str, request: Request):
    try:
        return request.app.state.archive_jobs.get(job_id)
    except KeyError:
        raise HTTPException(404, '归档任务不存在')


@router.post('/api/archive-jobs/{job_id}/retry')
async def retry_job(job_id: str, request: Request):
    try:
        return request.app.state.archive_jobs.retry(job_id)
    except KeyError:
        raise HTTPException(404, '归档任务不存在')
    except OSError:
        raise HTTPException(507, '无法保存重试请求，任务状态未修改。')


@router.post('/api/archive-jobs/{job_id}/cancel')
async def cancel_job(job_id: str, request: Request):
    try:
        return request.app.state.archive_jobs.cancel(job_id)
    except KeyError:
        raise HTTPException(404, '归档任务不存在')
    except OSError:
        raise HTTPException(507, '无法保存取消请求，任务状态未修改。')
