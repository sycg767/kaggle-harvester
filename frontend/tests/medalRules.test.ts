import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMedalRanks } from '../src/components/arena/medalRules.ts';

test('calculateMedalRanks 正确计算万队规模赛事的金银铜牌线 (30, 510, 1020)', () => {
  // 10208 支队伍（大型赛事）：
  // 金牌：10 + floor(10208 * 0.002) = 10 + 20 = 30（第 31 名超出 Top 10 + 0.2% 范围）
  // 银牌：floor(10208 * 0.05) = 510（第 511 名占比 5.0058% > 5%）
  // 铜牌：floor(10208 * 0.10) = 1020（第 1021 名占比 10.0019% > 10%）
  const ranks = calculateMedalRanks(10208);
  assert.equal(ranks.goldRank, 30);
  assert.equal(ranks.silverRank, 510);
  assert.equal(ranks.bronzeRank, 1020);
});

test('calculateMedalRanks 覆盖 Kaggle 全量梯度区间', () => {
  // 1000 支队伍基准线
  const r1000 = calculateMedalRanks(1000);
  assert.equal(r1000.goldRank, 12);
  assert.equal(r1000.silverRank, 50);
  assert.equal(r1000.bronzeRank, 100);

  // 250 - 999 队伍区间：固定 Top 10, Top 50, Top 100
  const r500 = calculateMedalRanks(500);
  assert.equal(r500.goldRank, 10);
  assert.equal(r500.silverRank, 50);
  assert.equal(r500.bronzeRank, 100);

  // 100 - 249 队伍区间：Top 10, Top 20%, Top 40%
  const r200 = calculateMedalRanks(200);
  assert.equal(r200.goldRank, 10);
  assert.equal(r200.silverRank, 40);
  assert.equal(r200.bronzeRank, 80);

  // 0 - 99 队伍区间：Top 10%, Top 20%, Top 40%
  const r80 = calculateMedalRanks(80);
  assert.equal(r80.goldRank, 8);
  assert.equal(r80.silverRank, 16);
  assert.equal(r80.bronzeRank, 32);

  // 0 队伍边界
  const r0 = calculateMedalRanks(0);
  assert.equal(r0.goldRank, 0);
  assert.equal(r0.silverRank, 0);
  assert.equal(r0.bronzeRank, 0);
});
