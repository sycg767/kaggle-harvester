import assert from 'node:assert/strict';
import test from 'node:test';
import { computeEndPointLayouts } from '../src/components/trajectory/trajectoryLayout.ts';
import type { ChartSeries } from '../src/components/trajectory/trajectoryMath.ts';

const series = (id: number, coordinates: [number, number][]): ChartSeries => {
  const points = coordinates.map(([x, y], index) => ({ x, y, episodeId: id * 100 + index, result: 'unknown' as const }));
  return { id, label: `Agent ${id}`, color: '#123456', points, latest: points.at(-1), games: points.at(-1)?.x ?? 0 };
};
const layout = (curves: ChartSeries[]) => computeEndPointLayouts(curves, (x) => x * 12, (y) => 400 - y / 10);

test('较短曲线在同局领先时向上标注，即使另一曲线最终分更高', () => {
  const labels = layout([
    series(1, [[1, 600], [35, 2583.6]]),
    series(2, [[1, 680], [30, 2420], [40, 2530], [52, 2610]]),
  ]);
  const shorter = labels.find((item) => item.id === 1)!;
  assert.ok(shorter.textY < shorter.ptY, 'The label should move above the locally leading red curve');
  assert.equal(shorter.textAnchor, 'middle');
  const longest = labels.find((item) => item.id === 2)!;
  assert.equal(longest.textAnchor, 'start');
  assert.ok(longest.textX > longest.ptX, 'The longest curve retains its right-side label');
});

test('较短曲线在同局落后时向下标注，即使另一曲线最终分更低', () => {
  const shorter = layout([
    series(1, [[1, 600], [35, 2400]]),
    series(2, [[1, 680], [30, 2500], [40, 2550], [52, 2300]]),
  ]).find((item) => item.id === 1)!;
  assert.ok(shorter.textY > shorter.ptY);
});

test('其他曲线未覆盖该局数时不外推分数干扰标注方向', () => {
  const shorter = layout([
    series(1, [[1, 600], [35, 2400]]),
    series(2, [[40, 2900], [52, 3000]]),
    series(3, [[1, 2500], [20, 2900]]),
  ]).find((item) => item.id === 1)!;
  assert.ok(shorter.textY < shorter.ptY);
});

test('终点夹在两条曲线之间时选择局部空间更大的一侧', () => {
  const shorter = layout([
    series(1, [[1, 600], [35, 2400]]),
    series(2, [[30, 2490], [40, 2490], [52, 2200]]),
    series(3, [[30, 2390], [40, 2390], [60, 2600]]),
  ]).find((item) => item.id === 1)!;
  assert.ok(shorter.textY < shorter.ptY, 'The gap above is wider than the gap below');
});
