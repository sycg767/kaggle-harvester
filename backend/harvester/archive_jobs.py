"""Durable single-worker queue for user initiated archives."""
from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .models import ArchiveRequest, ScoreDirection

LOGGER = logging.getLogger(__name__)


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def read_json_safely(path: Path):
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            raise ValueError('Expected a JSON object')
        return data
    except (OSError, ValueError):
        # Keep the original file for recovery. Never overwrite an unreadable store.
        LOGGER.exception('Cannot read archive state: %s', path)
        return None


def perform_archive(archiver, client, req: ArchiveRequest):
    direction = req.score_direction
    if direction == ScoreDirection.AUTO:
        info = client.fetch_competition_info(req.competition or client.competition_slug)
        if info.score_direction_source == 'fallback':
            raise ValueError('竞赛分数方向无法可靠识别，请明确选择 minimize 或 maximize。')
        direction = ScoreDirection.MINIMIZE if info.is_lower_better else ScoreDirection.MAXIMIZE
    result = archiver.archive_kernel(
        kernel_ref=req.kernel_ref, version=req.version, score_direction=direction.value,
        include_outputs=req.include_outputs, competition=req.competition, overwrite=req.overwrite,
    )
    try:
        for version in client.get_kernel_versions(req.kernel_ref).versions:
            if version.version_number == result.selected_version:
                result.public_score = version.public_lb_numeric
                archiver.update_public_score(f'{result.owner_slug}__{result.kernel_slug}__v{result.selected_version}', result.public_score)
                break
    except Exception:
        pass
    data = result.model_dump(mode='json')
    # Full metadata/versions live in the archive, not in every queue status response.
    data['metadata'], data['versions'] = {}, []
    return data


class ArchiveJobManager:
    def __init__(self, harvest_root, archiver, client):
        self.path = Path(harvest_root) / '_cache' / 'archive_jobs.json'
        self.directory = self.path.with_suffix('')
        self.archiver, self.client = archiver, client
        self.jobs = {}
        legacy = read_json_safely(self.path)
        candidates = list((legacy or {}).values())
        for path in self.directory.glob('*.json'):
            data = read_json_safely(path)
            if data:
                candidates.append(data)
        for job in candidates:
            try:
                if not isinstance(job['id'], str) or len(job['id']) != 32 or any(c not in '0123456789abcdef' for c in job['id']):
                    raise ValueError('Invalid job id')
                if not 1 <= len(job['items']) <= 100:
                    raise ValueError('Invalid item count')
                for item in job['items']:
                    ArchiveRequest(**item['request'])
                    if item['status'] not in {'pending', 'running', 'succeeded', 'existing', 'failed', 'cancelled'}:
                        raise ValueError('Invalid item status')
                    if item['status'] == 'running':
                        item['status'] = 'pending'
                self._status(job, touch=False)
                self.jobs[job['id']] = job
            except (KeyError, TypeError, ValueError):
                LOGGER.exception('Ignoring invalid archive job; original file is preserved')
        self.jobs = dict(sorted(self.jobs.items(), key=lambda pair: pair[1].get('created_at', '')))
        self.persistence_error = None
        self.task = None
        self.wake = asyncio.Event()
        self.stopping = False

    def _status(self, job, touch=True):
        states = {item['status'] for item in job['items']}
        job['status'] = ('running' if 'running' in states else 'pending' if 'pending' in states
                         else 'failed' if 'failed' in states else 'cancelled' if 'cancelled' in states else 'succeeded')
        if touch:
            job['updated_at'] = now()

    def _save(self, job):
        atomic_json(self.directory / f"{job['id']}.json", job)

    def get(self, job_id):
        result = copy.deepcopy(self.jobs[job_id])
        result.pop('original_requests', None)
        if self.persistence_error:
            result['persistence_error'] = '任务状态保存失败；后台队列已暂停重试，请检查存储空间及权限。'
        return result

    def list(self, competition=None, limit=20):
        # Never hide an older running/pending task behind newer completed work.
        # limit bounds recent terminal jobs; active jobs remain visible in FIFO order.
        active, recent = [], []
        for job in self.jobs.values():
            if job['status'] not in {'pending', 'running'}:
                continue
            if not competition or any(i['request'].get('competition') == competition for i in job['items']):
                active.append(self.get(job['id']))
        for job in reversed(self.jobs.values()):
            if job['status'] in {'pending', 'running'}:
                continue
            if not competition or any(i['request'].get('competition') == competition for i in job['items']):
                recent.append(self.get(job['id']))
                if len(recent) >= limit:
                    break
        return active + recent

    def create(self, items, request_id=None):
        requests = [item.model_dump(mode='json') for item in items]
        if request_id:
            for job in self.jobs.values():
                if job.get('request_id') == request_id:
                    if job.get('original_requests', [item['request'] for item in job['items']]) != requests:
                        raise ValueError('request_id 已用于不同的归档请求')
                    return self.get(job['id'])
        timestamp = now()
        original_requests = copy.deepcopy(requests)
        for req in requests:
            req['competition'] = req['competition'] or getattr(self.client, 'competition_slug', None)
        job = {'id': uuid.uuid4().hex, 'request_id': request_id, 'status': 'pending',
               'original_requests': original_requests,
               'created_at': timestamp, 'updated_at': timestamp,
               'items': [{'id': str(index), 'request': req, 'status': 'pending', 'result': None, 'error': None}
                         for index, req in enumerate(requests)]}
        self._save(job)
        self.jobs[job['id']] = job
        self.wake.set()
        return self.get(job['id'])

    def retry(self, job_id):
        job = copy.deepcopy(self.jobs[job_id])
        for item in job['items']:
            if item['status'] == 'failed':
                item.update(status='pending', error=None, result=None)
        self._status(job)
        self._save(job)
        self._replace_job(job)
        self.wake.set()
        return self.get(job_id)

    def cancel(self, job_id):
        job = copy.deepcopy(self.jobs[job_id])
        for item in job['items']:
            if item['status'] == 'pending':
                item['status'] = 'cancelled'
        self._status(job)
        self._save(job)
        self._replace_job(job)
        return self.get(job_id)

    def _replace_job(self, updated):
        # Preserve references held by the worker during an in-flight download.
        job = self.jobs[updated['id']]
        for original, changed in zip(job['items'], updated['items']):
            original.update(changed)
        job['status'], job['updated_at'] = updated['status'], updated['updated_at']

    async def start(self):
        self.stopping = False
        self.task = asyncio.create_task(self._worker())

    async def stop(self):
        # Let the in-flight filesystem operation finish; cancelling to_thread cannot stop it.
        self.stopping = True
        self.wake.set()
        if self.task:
            await self.task

    async def _worker(self):
        while not self.stopping:
            self.wake.clear()
            selected = next(((j, i) for j in self.jobs.values() for i in j['items'] if i['status'] == 'pending'), None)
            if selected is None:
                await self.wake.wait()
                continue
            job, item = selected
            item['status'] = 'running'
            self._status(job)
            try:
                self._save(job)
            except OSError as exc:
                item['status'] = 'pending'
                self._status(job)
                self.persistence_error = str(exc)
                LOGGER.exception('Archive queue paused: cannot persist the next download')
                await self._wait_after_save_failure()
                continue
            try:
                result = await asyncio.to_thread(perform_archive, self.archiver, self.client, ArchiveRequest(**item['request']))
                item.update(result=result, status='existing' if result.get('already_existed') else 'succeeded', error=None)
            except Exception as exc:
                item.update(status='failed', error=str(exc)[:2000])
            self._status(job)
            # Retry persistence before performing another download. On restart a
            # saved running item is safely resumed through the idempotent archiver.
            while True:
                try:
                    self._save(job)
                    self.persistence_error = None
                    break
                except OSError as exc:
                    self.persistence_error = str(exc)
                    LOGGER.exception('Archive result could not be persisted')
                    if self.stopping:
                        return
                    await self._wait_after_save_failure()

    async def _wait_after_save_failure(self):
        try:
            await asyncio.wait_for(self.wake.wait(), timeout=5)
        except asyncio.TimeoutError:
            pass
        self.wake.clear()
