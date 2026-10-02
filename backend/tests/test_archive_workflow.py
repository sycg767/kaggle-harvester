from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from harvester.archive_jobs import ArchiveJobManager
from harvester.archive_source import preview_source, compare_sources
from harvester.models import ArchiveRequest
from routers.archive_jobs import router as jobs_router
from routers.archive_source import router as source_router
from routers.archives import router as archives_router


class ArchiveWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_during_download_and_shutdown_waits_for_completion(self):
        with tempfile.TemporaryDirectory() as root:
            manager = ArchiveJobManager(root, None, None)
            job = manager.create([ArchiveRequest(kernel_ref='a/b'), ArchiveRequest(kernel_ref='a/c')])
            entered, release = threading.Event(), threading.Event()
            def archive(*_):
                entered.set()
                release.wait(3)
                return {'already_existed': False}
            with patch('harvester.archive_jobs.perform_archive', side_effect=archive) as action:
                await manager.start()
                await asyncio.to_thread(entered.wait, 2)
                self.assertEqual(manager.cancel(job['id'])['status'], 'running')
                stopping = asyncio.create_task(manager.stop())
                await asyncio.sleep(.01)
                self.assertFalse(stopping.done())
                release.set()
                await stopping
            self.assertEqual(action.call_count, 1)
            self.assertEqual([i['status'] for i in manager.get(job['id'])['items']], ['succeeded', 'cancelled'])
            self.assertEqual(ArchiveJobManager(root, None, None).get(job['id'])['status'], 'cancelled')

    async def test_save_failure_never_enqueues_or_mutates_cancel(self):
        with tempfile.TemporaryDirectory() as root:
            manager = ArchiveJobManager(root, None, None)
            with patch.object(manager, '_save', side_effect=OSError('disk full')):
                with self.assertRaises(OSError):
                    manager.create([ArchiveRequest(kernel_ref='a/b')])
            self.assertEqual(manager.list(), [])
            job = manager.create([ArchiveRequest(kernel_ref='a/b')])
            with patch.object(manager, '_save', side_effect=OSError('disk full')):
                with self.assertRaises(OSError):
                    manager.cancel(job['id'])
            self.assertEqual(manager.get(job['id'])['items'][0]['status'], 'pending')

    async def test_bad_json_does_not_break_service_and_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            cache = Path(root)/'_cache'
            cache.mkdir()
            (cache/'archive_jobs.json').write_text('{broken', encoding='utf8')
            with self.assertLogs('harvester.archive_jobs', level='ERROR'):
                manager = ArchiveJobManager(root, None, None)
            manager.create([ArchiveRequest(kernel_ref='a/b')])
            self.assertEqual((cache/'archive_jobs.json').read_text(), '{broken')

    async def test_default_competition_frozen_and_limit_applied_before_copy(self):
        with tempfile.TemporaryDirectory() as root:
            client = SimpleNamespace(competition_slug='first')
            manager = ArchiveJobManager(root, None, client)
            body = [ArchiveRequest(kernel_ref='a/b')]
            first = manager.create(body, 'idempotency')
            client.competition_slug = 'second'
            self.assertEqual(manager.create(body, 'idempotency')['id'], first['id'])
            self.assertEqual(first['items'][0]['request']['competition'], 'first')
            for _ in range(3):
                manager.create(body)
            for job in manager.jobs.values():
                job['status'] = 'succeeded'
            with patch.object(manager, 'get', wraps=manager.get) as copied:
                self.assertEqual(len(manager.list(limit=2)), 2)
                self.assertEqual(copied.call_count, 2)

    async def test_older_active_jobs_remain_visible_after_twenty_terminal_jobs(self):
        with tempfile.TemporaryDirectory() as root:
            manager = ArchiveJobManager(root, None, None)
            body = [ArchiveRequest(kernel_ref='a/b', competition='first')]
            running = manager.create(body)
            manager.jobs[running['id']]['status'] = 'running'
            pending = manager.create(body)
            for _ in range(25):
                terminal = manager.create(body)
                manager.jobs[terminal['id']]['status'] = 'succeeded'
            jobs = manager.list('first')
            self.assertEqual(len(jobs), 22)
            self.assertEqual([job['id'] for job in jobs[:2]], [running['id'], pending['id']])
            self.assertEqual(manager.list('other'), [])

    async def test_durable_queue_retries_only_failed_and_keeps_existing(self):
        with tempfile.TemporaryDirectory() as root:
            manager = ArchiveJobManager(root, None, None)
            requests = [ArchiveRequest(kernel_ref=f'user/{x}', competition='competition') for x in ('new', 'existing', 'fail')]
            job = manager.create(requests, 'request-key')
            self.assertEqual(manager.create(requests, 'request-key')['id'], job['id'])
            with self.assertRaises(ValueError):
                manager.create(requests[:1], 'request-key')
            calls = []
            def archive(_archiver, _client, req):
                calls.append(req.kernel_ref)
                if req.kernel_ref.endswith('fail') and calls.count(req.kernel_ref) == 1:
                    raise OSError('download failed')
                return {'already_existed': req.kernel_ref.endswith('existing')}
            with patch('harvester.archive_jobs.perform_archive', side_effect=archive):
                await manager.start()
                for _ in range(200):
                    if manager.get(job['id'])['status'] == 'failed':
                        break
                    await asyncio.sleep(.005)
                self.assertEqual([i['status'] for i in manager.get(job['id'])['items']], ['succeeded', 'existing', 'failed'])
                manager.retry(job['id'])
                for _ in range(200):
                    if manager.get(job['id'])['status'] == 'succeeded':
                        break
                    await asyncio.sleep(.005)
                await manager.stop()
            self.assertEqual(len(calls), 4)
            reloaded = ArchiveJobManager(root, None, None)
            self.assertEqual(reloaded.get(job['id'])['status'], 'succeeded')
            self.assertEqual(len(reloaded.list('competition')), 1)
            self.assertEqual(reloaded.list('other'), [])

    async def test_restart_recovers_running_but_not_cancelled(self):
        with tempfile.TemporaryDirectory() as root:
            manager = ArchiveJobManager(root, None, None)
            job = manager.create([ArchiveRequest(kernel_ref='a/b')] * 2)
            manager.jobs[job['id']]['items'][0]['status'] = 'running'
            manager.cancel(job['id'])
            recovered = ArchiveJobManager(root, None, None).get(job['id'])
            self.assertEqual([i['status'] for i in recovered['items']], ['pending', 'cancelled'])

    async def test_api_limits_and_retired_study_routes_preserve_legacy_file(self):
        with tempfile.TemporaryDirectory() as root:
            app = FastAPI()
            app.include_router(jobs_router)
            app.include_router(source_router)
            app.state.archive_jobs = ArchiveJobManager(root, None, None)
            app.include_router(archives_router)
            legacy = Path(root)/'_cache'/'archive_studies.json'
            legacy.parent.mkdir(parents=True, exist_ok=True)
            original = b'{"known":{"status":"read","notes":"legacy note","tags":[]}}'
            legacy.write_bytes(original)
            entry = SimpleNamespace(id='known', model_dump=lambda: {'id': 'known'})
            app.state.archiver = SimpleNamespace(get_archive=lambda key: entry if key == 'known' else None, list_archives=lambda **_: [entry])
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                self.assertEqual((await client.post('/api/archive-jobs', json={'items': []})).status_code, 422)
                self.assertEqual((await client.post('/api/archive-jobs', json={'items': [{'kernel_ref':'a/b'}]*101})).status_code, 422)
                self.assertEqual((await client.get('/api/archive-jobs/missing')).status_code, 404)
                self.assertEqual((await client.put('/api/archives/known/study', json={'notes':'new'})).status_code, 404)
                self.assertEqual((await client.get('/api/archives/known/study')).status_code, 404)
                self.assertEqual((await client.get('/api/archives/studies')).status_code, 404)
                listing = await client.get('/api/archives')
                self.assertEqual(listing.status_code, 200)
                self.assertEqual(listing.json(), [{'id': 'known'}])
            self.assertEqual(legacy.read_bytes(), original)


class SourceTests(unittest.TestCase):
    def test_notebook_preview_ignores_outputs_and_diff_checks_ref(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            first, second = directory/'one.ipynb', directory/'two.py'
            first.write_text(json.dumps({'cells':[{'cell_type':'code','source':['print(1)'], 'outputs':[{'data':{'text/html':'SECRET OUTPUT'}}]}]}), encoding='utf8')
            second.write_text('print(2)', encoding='utf8')
            entries = {'one':SimpleNamespace(ref='a/b', version_number=1), 'two':SimpleNamespace(ref='a/b', version_number=2)}
            archiver = SimpleNamespace(get_archive=entries.get, get_archive_path=lambda _: directory, get_archive_source_path=lambda key: first if key=='one' else second)
            preview = preview_source(archiver, 'one')
            self.assertIn('print(1)', preview['content'])
            self.assertNotIn('SECRET', preview['content'])
            self.assertIn('+print(2)', compare_sources(archiver, 'one', 'two')['diff'])
            entries['two'].ref = 'other/ref'
            with self.assertRaises(ValueError):
                compare_sources(archiver, 'one', 'two')
            second.write_bytes(b'x'*(2*1024*1024+1))
            with self.assertRaises(OverflowError):
                preview_source(archiver, 'two')

    def test_preview_refuses_external_source(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)/'archive'
            directory.mkdir()
            external = Path(root)/'secret.py'
            external.write_text('secret')
            archiver = SimpleNamespace(get_archive=lambda _: object(), get_archive_path=lambda _:directory, get_archive_source_path=lambda _: external)
            with self.assertRaises(ValueError):
                preview_source(archiver, 'one')
