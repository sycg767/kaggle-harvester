import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../src/api.ts';

test('列表接口能识别后台刷新状态并保留旧快照', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | undefined;
  globalThis.fetch = async (_input, init) => {
    receivedSignal = init?.signal as AbortSignal | undefined;
    return new Response(JSON.stringify([{
      ref: 'owner/notebook',
      title: 'Notebook',
      author: 'owner',
      vote_count: 0,
      total_votes: 0,
      is_competition_kernel: true,
      kernel_type: 'notebook',
      category: '',
    }]), {
      headers: {
        'Content-Type': 'application/json',
        'X-Kernel-Cache': 'STALE',
        'X-Kernel-Cache-Age': '601',
        'X-Kernel-Refresh': 'running',
      },
    });
  };

  try {
    const controller = new AbortController();
    const result = await api.listKernels({
      competition: 'example-competition',
      signal: controller.signal,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.cache.state, 'STALE');
    assert.equal(result.cache.refreshing, true);
    assert.equal(result.cache.refresh_state, 'running');
    assert.equal(receivedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('竞赛接口会传递刷新参数和取消信号', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let receivedSignal: AbortSignal | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    receivedSignal = init?.signal as AbortSignal | undefined;
    return new Response(JSON.stringify({
      id: 'example-competition',
      title: 'Example',
      category: 'featured',
      is_lower_better: false,
      score_direction_source: 'leaderboard',
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const controller = new AbortController();
    const result = await api.getCompetition('example-competition', {
      refresh: true,
      signal: controller.signal,
    });
    assert.match(requestedUrl, /competition=example-competition/);
    assert.match(requestedUrl, /refresh=true/);
    assert.equal(receivedSignal, controller.signal);
    assert.equal(result.is_lower_better, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

