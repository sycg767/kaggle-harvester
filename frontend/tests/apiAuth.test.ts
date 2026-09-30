import assert from 'node:assert/strict';
import test from 'node:test';
import { api, apiAuth } from '../src/api.ts';

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

test('认证失败不会自动删除浏览器中保存的密钥', async () => {
  const originalFetch = globalThis.fetch;
  apiAuth.setKey('saved-key', true);
  globalThis.fetch = async () => new Response('unauthorized', {
    status: 401, headers: { 'X-Harvester-Auth': 'required' },
  });
  try {
    await assert.rejects(api.health());
    assert.equal(apiAuth.getKey(), 'saved-key');
  } finally {
    apiAuth.clearKey();
    globalThis.fetch = originalFetch;
  }
});
