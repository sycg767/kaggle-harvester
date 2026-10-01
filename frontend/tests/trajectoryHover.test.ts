import assert from 'node:assert/strict';
import test from 'node:test';
import { findTrajectoryHit, type HoverSeries } from '../src/components/trajectory/trajectoryHover.ts';

test('鼠标靠近多条曲线时命中距离最近的曲线和真实数据点', () => {
  const series = [
    { id: 101, points: [{ x: 0, y: 10 }, { x: 100, y: 10 }] },
    { id: 202, points: [{ x: 0, y: 30 }, { x: 100, y: 30 }] },
  ];

  assert.deepEqual(findTrajectoryHit(series, 20, 26), { seriesId: 202, pointIndex: 0 });
  assert.deepEqual(findTrajectoryHit(series, 90, 13), { seriesId: 101, pointIndex: 1 });
});

test('交叉曲线附近根据线段距离选择而非固定选择最后一条曲线', () => {
  const series = [
    { id: 101, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
    { id: 202, points: [{ x: 0, y: 100 }, { x: 100, y: 0 }] },
  ];

  assert.deepEqual(findTrajectoryHit(series, 55, 56), { seriesId: 101, pointIndex: 1 });
  assert.deepEqual(findTrajectoryHit(series, 55, 44), { seriesId: 202, pointIndex: 1 });
});

test('稀疏长线段中间也能命中且返回较近真实端点', () => {
  const series = [{ id: 7, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }];

  assert.deepEqual(findTrajectoryHit(series, 400, 4), { seriesId: 7, pointIndex: 0 });
  assert.deepEqual(findTrajectoryHit(series, 600, 4), { seriesId: 7, pointIndex: 1 });
});

test('斜线按在线段上的投影选择真实端点', () => {
  const series = [{ id: 8, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }];

  assert.deepEqual(findTrajectoryHit(series, 40, 45), { seriesId: 8, pointIndex: 0 });
  assert.deepEqual(findTrajectoryHit(series, 55, 60), { seriesId: 8, pointIndex: 1 });
});

test('单点曲线可命中且超出默认半径后不再命中', () => {
  const series = [{ id: 9, points: [{ x: 30, y: 40 }] }];

  assert.deepEqual(findTrajectoryHit(series, 39, 52), { seriesId: 9, pointIndex: 0 });
  assert.equal(findTrajectoryHit(series, 47, 40), null);
});

test('无曲线和仅包含空曲线时返回空命中', () => {
  assert.equal(findTrajectoryHit([], 50, 50), null);
  assert.equal(findTrajectoryHit([{ id: 1, points: [] }], 50, 50), null);
});

test('命中半径可调整且恰好在边界上的点仍可命中', () => {
  const series = [{ id: 11, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }];

  assert.deepEqual(findTrajectoryHit(series, 20, 16), { seriesId: 11, pointIndex: 0 });
  assert.equal(findTrajectoryHit(series, 20, 16.01), null);
  assert.equal(findTrajectoryHit(series, 20, 7, 6), null);
  assert.deepEqual(findTrajectoryHit(series, 20, 7, 8), { seriesId: 11, pointIndex: 0 });
});

test('线段两端之外使用端点距离而非无限延长线', () => {
  const series = [{ id: 12, points: [{ x: 10, y: 20 }, { x: 100, y: 20 }] }];

  assert.deepEqual(findTrajectoryHit(series, 0, 20), { seriesId: 12, pointIndex: 0 });
  assert.deepEqual(findTrajectoryHit(series, 110, 20), { seriesId: 12, pointIndex: 1 });
  assert.equal(findTrajectoryHit(series, -7, 20), null);
  assert.equal(findTrajectoryHit(series, 117, 20), null);
});

test('不同长度曲线和空曲线混合时保留正确曲线 ID 与点索引', () => {
  const series = [
    { id: 1, points: [] },
    { id: 2, points: [{ x: 10, y: 10 }] },
    { id: 3, points: [{ x: 0, y: 40 }, { x: 100, y: 40 }] },
    { id: 4, points: [{ x: 0, y: 80 }, { x: 30, y: 80 }, { x: 60, y: 80 }, { x: 90, y: 80 }] },
  ];

  assert.deepEqual(findTrajectoryHit(series, 82, 81), { seriesId: 4, pointIndex: 3 });
  assert.deepEqual(findTrajectoryHit(series, 11, 12), { seriesId: 2, pointIndex: 0 });
  assert.deepEqual(findTrajectoryHit(series, 75, 41), { seriesId: 3, pointIndex: 1 });
});

test('多次命中查询不会排序或修改输入曲线和数据点', () => {
  const series: HoverSeries[] = [
    { id: 20, points: [{ x: 100, y: 20 }, { x: 50, y: 20 }, { x: 0, y: 20 }] },
    { id: 10, points: [{ x: 0, y: 50 }] },
  ];
  const expected = structuredClone(series);
  for (const item of series) {
    item.points.forEach(Object.freeze);
    Object.freeze(item.points);
    Object.freeze(item);
  }
  Object.freeze(series);

  assert.deepEqual(findTrajectoryHit(series, 90, 20), { seriesId: 20, pointIndex: 0 });
  assert.deepEqual(findTrajectoryHit(series, 0, 50), { seriesId: 10, pointIndex: 0 });
  assert.equal(findTrajectoryHit(series, 500, 500), null);
  assert.deepEqual(series, expected);
});
