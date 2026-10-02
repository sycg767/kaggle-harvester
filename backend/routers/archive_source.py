from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from harvester.archive_source import preview_source, compare_sources

router = APIRouter(tags=['Archive source'])


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
