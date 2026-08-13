import assert from 'node:assert/strict';
import test from 'node:test';
import { readScoreDirections, resolveScoreDirection, saveScoreDirection } from '../src/scoreDirection.ts';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

test('可靠来源直接采用竞赛方向', () => {
  const result = resolveScoreDirection('example', {
    id: 'example',
    title: 'Example',
    category: 'featured',
    is_lower_better: false,
    score_direction_source: 'leaderboard',
  });
  assert.deepEqual(result, { direction: 'maximize', source: 'leaderboard' });
});

test('fallback 需要用户确认并按竞赛持久化', () => {
  values.clear();
  const info = {
    id: 'example',
    title: 'Example',
    category: 'featured',
    is_lower_better: true,
    score_direction_source: 'fallback' as const,
  };
  assert.deepEqual(resolveScoreDirection('example', info), { direction: null, source: 'unknown' });
  saveScoreDirection('example', 'maximize');
  assert.equal(readScoreDirections().example, 'maximize');
  assert.deepEqual(resolveScoreDirection('example', info), { direction: 'maximize', source: 'user' });
});
