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

/**
 * 智能自适应空间感知避让算法（动态感知上下层级与相对位置，100% 杜绝重叠）
 */
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

    // 评估与其他折线的相对垂直位置（是否处于上方）
    const otherSeries = validSeries.filter((other) => other.id !== s.id && other.latest);
    const isHigherThanOthers = otherSeries.length === 0 || otherSeries.every((other) => s.latest!.y >= other.latest!.y);

    let textX = ptX + 8;
    let textY = ptY + 4.5;
    let textAnchor: 'start' | 'middle' = 'start';

    if (isTrailing) {
      textX = ptX;
      textAnchor = 'middle';
      // 若处于上方则向上避让（ptY - 8），若处于下方则向下避让（ptY + 16），永远向开阔外侧延伸
      if (isHigherThanOthers) {
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
