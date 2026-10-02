import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorResult } from '../src/monitorResult.ts';

test('HTTP success with failed or partial collection never creates a success notification', () => {
  assert.deepEqual(monitorResult({ status: { last_error: 'network down' }, logs: [{ outcome: 'failed' }] }, '完成'), { type: 'error', content: '检查失败：network down' });
  assert.equal(monitorResult({ status: {}, logs: [{ outcome: 'partial', error: 'one agent unavailable' }] }, '完成').type, 'warning');
  assert.equal(monitorResult({ status: { last_error: 'timed out' } }, '完成').type, 'warning');
  assert.deepEqual(monitorResult({ status: {}, logs: [{ outcome: 'success' }] }, '完成'), { type: 'success', content: '完成' });
});
