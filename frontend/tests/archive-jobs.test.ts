import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveJobs, summarizeArchiveJob, type ArchiveJob } from '../src/archiveJobs.ts';

test('归档统计区分新增、已有、失败与取消，不把等待任务视为完成', () => {
  const job = { items: ['succeeded', 'existing', 'failed', 'cancelled', 'pending', 'running'].map(status => ({ status })) } as ArchiveJob;
  assert.deepEqual(summarizeArchiveJob(job), { added: 1, existing: 1, failed: 1, cancelled: 1, pending: 1, running: 1, percent: 67 });
});

test('提交重试传递相同幂等标识，恢复列表按赛事查询', async () => {
  const original = globalThis.fetch;
  const requests: Array<{ url: string; body?: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: init?.body as string | undefined });
    return new Response(JSON.stringify({ id: 'job-1' }));
  };
  try {
    const items = [{ kernel_ref: 'owner/code', competition: 'competition-a', score_direction: 'minimize', include_outputs: false }];
    await archiveJobs.create(items, 'stable-id');
    await archiveJobs.create(items, 'stable-id');
    assert.equal(requests[0].body, requests[1].body);
    assert.equal(JSON.parse(requests[0].body!).request_id, 'stable-id');
    await archiveJobs.list('competition-a');
    assert.match(requests[2].url, /competition=competition-a/);
  } finally { globalThis.fetch = original; }
});

test('任务列表失败不会伪装为空任务列表', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  try { await assert.rejects(archiveJobs.list(), /503/); }
  finally { globalThis.fetch = original; }
});
