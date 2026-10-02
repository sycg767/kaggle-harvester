import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveSourceApi } from '../src/archiveSourceApi.ts';
import { ApiError } from '../src/api.ts';

test('预览超出服务端限制显示原始可操作错误', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: '源码超过 2 MB，请下载查看。' }), { status: 413 });
  try {
    await assert.rejects(archiveSourceApi.preview('id'), (error: unknown) => error instanceof ApiError && error.status === 413 && error.message.includes('下载'));
  } finally { globalThis.fetch = original; }
});

test('比较参数编码且保留差异纯文本', async () => {
  const original = globalThis.fetch;
  let url = '';
  globalThis.fetch = async input => { url = String(input); return new Response(JSON.stringify({ diff: '+<img src=x>', truncated: true })); };
  try {
    const result = await archiveSourceApi.compare('one', 'two&x=1');
    assert.equal(url, '/api/archives/one/compare?other_id=two%26x%3D1');
    assert.equal(result.diff, '+<img src=x>');
    assert.equal(result.truncated, true);
  } finally { globalThis.fetch = original; }
});
