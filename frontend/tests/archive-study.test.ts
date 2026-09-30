import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveStudyApi } from '../src/archiveStudyApi.ts';
import { ApiError } from '../src/api.ts';

test('研究状态保存仅提交可编辑字段并编码版本 ID', async () => {
  const original = globalThis.fetch;
  let url = ''; let body = ''; let method = '';
  globalThis.fetch = async (input, init) => {
    url = String(input); body = String(init?.body); method = String(init?.method);
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await archiveStudyApi.save('a/b', { status: 'planned', notes: '<script>unsafe()</script>', tags: ['baseline'], updated_at: 'do-not-write' });
    assert.equal(url, '/api/archives/a%2Fb/study');
    assert.equal(method, 'PUT');
    assert.deepEqual(JSON.parse(body), { status: 'planned', notes: '<script>unsafe()</script>', tags: ['baseline'] });
  } finally { globalThis.fetch = original; }
});

test('预览超出服务端限制显示原始可操作错误', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: '源码超过 2 MB，请下载查看。' }), { status: 413 });
  try {
    await assert.rejects(archiveStudyApi.preview('id'), (error: unknown) => error instanceof ApiError && error.status === 413 && error.message.includes('下载'));
  } finally { globalThis.fetch = original; }
});

test('比较参数编码且保留差异纯文本', async () => {
  const original = globalThis.fetch;
  let url = '';
  globalThis.fetch = async input => { url = String(input); return new Response(JSON.stringify({ diff: '+<img src=x>', truncated: true })); };
  try {
    const result = await archiveStudyApi.compare('one', 'two&x=1');
    assert.equal(url, '/api/archives/one/compare?other_id=two%26x%3D1');
    assert.equal(result.diff, '+<img src=x>');
    assert.equal(result.truncated, true);
  } finally { globalThis.fetch = original; }
});
