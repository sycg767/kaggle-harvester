import test from 'node:test';
import assert from 'node:assert/strict';
import plugin, { plainText } from './index.mjs';

test('微信强调、残缺星号和表格输出降为纯文本，保留数值与名称', () => {
  const output = plainText('## 战报\n**p46**：-0.5 分，model_v1\n*未闭合\n```text\n0.0 分\n```\n| 项目 | 数值 |\n| --- | --- |\n| 分数 | 951 |');
  assert.doesNotMatch(output, /[*`#]/);
  assert.match(output, /-0.5/);
  assert.match(output, /model_v1/);
  assert.match(output, /分数 · 951/);
});
test('仅处理微信渠道，不更改其他渠道；MEDIA路径保持不变', () => {
  let handler;
  plugin.register({ on: (name, fn) => { assert.equal(name, 'message_sending'); handler = fn; } });
  assert.deepEqual(handler({ content: '**重点**' }, { channelId: 'openclaw-weixin' }), { content: '重点' });
  assert.equal(handler({ content: '**重点**' }, { channelId: 'slack' }), undefined);
  assert.equal(plainText('MEDIA:/tmp/chart_v1.png'), 'MEDIA:/tmp/chart_v1.png');
});
