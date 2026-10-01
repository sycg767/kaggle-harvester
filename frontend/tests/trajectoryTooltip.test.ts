import assert from 'node:assert/strict';
import test from 'node:test';
import { placeTrajectoryTooltip, TOOLTIP_WIDTH, TOOLTIP_HEIGHT } from '../src/components/trajectory/trajectoryTooltip.ts';
import { formatTime } from '../src/components/trajectory/trajectoryMath.ts';

test('提示框在整个绘图区移动时始终留在边界内并与所选点分离', () => {
  const bounds = { left: 72, right: 880, top: 52, bottom: 346 };
  for (let x = bounds.left; x <= bounds.right; x += 4) {
    for (let y = bounds.top; y <= bounds.bottom; y += 2) {
      const box = placeTrajectoryTooltip(x, y, bounds);
      assert.ok(box.left >= bounds.left && box.left + TOOLTIP_WIDTH <= bounds.right);
      assert.ok(box.top >= bounds.top && box.top + TOOLTIP_HEIGHT <= bounds.bottom);
      const dx = Math.max(box.left - x, x - box.left - TOOLTIP_WIDTH, 0);
      const dy = Math.max(box.top - y, y - box.top - TOOLTIP_HEIGHT, 0);
      assert.ok(Math.hypot(dx, dy) >= 16, `Covered point ${x},${y}`);
    }
  }
});

test('右上方截图场景翻转到左下方，横向滚动时限制在可见区', () => {
  const box = placeTrajectoryTooltip(680, 96.3, { left: 72, right: 880, top: 52, bottom: 346 });
  assert.ok(box.left + TOOLTIP_WIDTH < 680 && box.top > 96.3);
  const scrolled = placeTrajectoryTooltip(730, 96.3, { left: 450, right: 880, top: 52, bottom: 346 });
  assert.ok(scrolled.left >= 450 && scrolled.left + TOOLTIP_WIDTH <= 880);
});

test('轨迹时间与对局列表一样按北京时间显示，兼容UTC及显式偏移', () => {
  const expected = '10/01 18:29';
  for (const value of ['2026-10-01T10:29:00', '2026-10-01 10:29:00', '2026-10-01T10:29:00Z', '2026-10-01T18:29:00+08:00']) {
    assert.equal(formatTime(value), expected);
  }
  assert.equal(formatTime('2026-10-01T20:29:00Z'), '10/02 04:29');
  assert.equal(formatTime('invalid'), '');
  assert.equal(formatTime(), '');
});
