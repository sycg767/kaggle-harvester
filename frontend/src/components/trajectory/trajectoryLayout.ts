import type { ChartSeries } from './trajectoryMath';

export interface EndPointLayoutItem {
  id: number;
  label: string;
  color: string;
  scoreStr: string;
  ptX: number;
  ptY: number;
  textX: number;
  textY: number;
  targetY: number;
  textAnchor: 'start' | 'middle';
}

const scoreAtGame = (points: ChartSeries['points'], game: number): number | undefined => {
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    if (start.x === game) return start.y;
    const end = points[index + 1];
    if (!end || game < Math.min(start.x, end.x) || game > Math.max(start.x, end.x)) continue;
    const fraction = (game - start.x) / (end.x - start.x);
    return start.y + fraction * (end.y - start.y);
  }
  return undefined;
};

/** Place score labels beside their endpoints and separate nearby labels. */
export const computeEndPointLayouts = (
  series: ChartSeries[],
  xScale: (value: number) => number,
  yScale: (value: number) => number,
): EndPointLayoutItem[] => {
  const validSeries = series.filter((s) => s.latest);
  if (validSeries.length === 0) return [];

  const maxPlotX = Math.max(...validSeries.map((s) => xScale(s.latest!.x)));

  // 1. 初始方向决策：根据相对层级与位置确定最优朝向 (Top / Bottom / Right)
  const items: EndPointLayoutItem[] = validSeries.map((s) => {
    const ptX = xScale(s.latest!.x);
    const ptY = yScale(s.latest!.y);
    const isTrailing = ptX < maxPlotX - 10;

    // Different length series must be compared at this endpoint's game, not at their own endpoints.
    const otherSeries = validSeries.filter((other) => other.id !== s.id && other.latest);
    const otherYs = otherSeries
      .map((other) => scoreAtGame(other.points, s.latest!.x))
      .filter((score): score is number => score !== undefined)
      .map(yScale);
    const spaceAbove = Math.min(Infinity, ...otherYs.filter((y) => y <= ptY).map((y) => ptY - y));
    const spaceBelow = Math.min(Infinity, ...otherYs.filter((y) => y >= ptY).map((y) => y - ptY));
    const placeAbove = spaceAbove >= spaceBelow;

    let textX = ptX + 8;
    let textY = ptY + 4.5;
    let textAnchor: 'start' | 'middle' = 'start';

    if (isTrailing) {
      textX = ptX;
      textAnchor = 'middle';
      // Prefer the side with more clearance from the other curves at this game.
      if (placeAbove) {
        textY = ptY - 8;
      } else {
        textY = ptY + 16;
      }
    }

    return {
      id: s.id,
      label: s.label,
      color: s.color,
      scoreStr: s.latest!.y.toFixed(1),
      ptX,
      ptY,
      textX,
      textY,
      targetY: textY,
      textAnchor,
    };
  });

  // 2. 包围盒重叠检测与弹性排斥力迭代（防止任意局数相同、分差极近时文字粘连重叠）
  const MIN_GAP_Y = 18;
  for (let iter = 0; iter < 10; iter += 1) {
    let changed = false;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const itemA = items[i];
        const itemB = items[j];

        // 水平距离接近（包围盒 X 轴重叠）
        const dx = Math.abs(itemA.textX - itemB.textX);
        if (dx < 45) {
          const dy = itemB.targetY - itemA.targetY;
          if (Math.abs(dy) < MIN_GAP_Y) {
            const overlap = MIN_GAP_Y - Math.abs(dy);
            if (itemA.targetY <= itemB.targetY) {
              itemA.targetY -= overlap / 2;
              itemB.targetY += overlap / 2;
            } else {
              itemA.targetY += overlap / 2;
              itemB.targetY -= overlap / 2;
            }
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  return items.map((item) => ({
    ...item,
    textY: item.targetY,
  }));
};
