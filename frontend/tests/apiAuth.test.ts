import assert from 'node:assert/strict';
import test from 'node:test';
import { apiAuth } from '../src/api.ts';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
};

Object.defineProperty(globalThis, 'sessionStorage', { value: createStorage() });
Object.defineProperty(globalThis, 'localStorage', { value: createStorage() });

test('未记住时只保存到当前会话', () => {
  apiAuth.clearKey();
  apiAuth.setKey('session-key', false);
  assert.equal(sessionStorage.getItem('harvester.apiKey'), 'session-key');
  assert.equal(localStorage.getItem('harvester.apiKey'), null);
  assert.equal(apiAuth.getKey(), 'session-key');
});

test('记住浏览器时持久保存并清除旧会话值', () => {
  apiAuth.setKey('session-key', false);
  apiAuth.setKey('persistent-key', true);
  assert.equal(sessionStorage.getItem('harvester.apiKey'), null);
  assert.equal(localStorage.getItem('harvester.apiKey'), 'persistent-key');
  assert.equal(apiAuth.getKey(), 'persistent-key');
});

test('清除密钥会同时清理会话和持久存储', () => {
  sessionStorage.setItem('harvester.apiKey', 'old-session');
  localStorage.setItem('harvester.apiKey', 'old-persistent');
  apiAuth.clearKey();
  assert.equal(apiAuth.getKey(), '');
});
