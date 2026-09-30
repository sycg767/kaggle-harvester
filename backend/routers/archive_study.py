from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from harvester.archive_study import StudyUpdate, preview_source, compare_sources

router = APIRouter(tags=['Archive study'])


@router.get('/api/archives/studies')
async def list_studies(request: Request):
    check_study_store(request)
    return request.app.state.archive_studies.records


def check_study_store(request):
    if request.app.state.archive_studies.read_error:
        raise HTTPException(503, '研究记录文件损坏或不可读，请恢复原文件后重启服务。')


def check_archive(request, archive_id):
    if request.app.state.archiver.get_archive(archive_id) is None:
        raise HTTPException(404, '归档不存在')


@router.get('/api/archives/{archive_id}/study')
async def get_study(archive_id: str, request: Request):
    check_archive(request, archive_id)
    check_study_store(request)
    return request.app.state.archive_studies.get(archive_id)


@router.put('/api/archives/{archive_id}/study')
async def put_study(archive_id: str, body: StudyUpdate, request: Request):
    """verified is the user's own confirmation, never an automatic reproducibility claim."""
    check_archive(request, archive_id)
    try:
        return request.app.state.archive_studies.put(archive_id, body)
    except OSError:
        raise HTTPException(507, '研究记录无法保存，请检查存储空间、权限和记录文件；原记录未修改。')


async def source_operation(fn, *args):
    try:
        return await run_in_threadpool(fn, *args)
    except (KeyError, FileNotFoundError):
        raise HTTPException(404, '归档或源文件不存在')
    except OverflowError as exc:
        raise HTTPException(413, str(exc))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(422, '无法预览源文件，或比较的并非同一 Notebook 的不同版本')


@router.get('/api/archives/{archive_id}/preview')
async def preview(archive_id: str, request: Request):
    return await source_operation(preview_source, request.app.state.archiver, archive_id)


@router.get('/api/archives/{archive_id}/compare')
async def compare(archive_id: str, other_id: str, request: Request):
    return await source_operation(compare_sources, request.app.state.archiver, archive_id, other_id)
