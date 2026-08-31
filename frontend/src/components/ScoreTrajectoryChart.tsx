import React, { useMemo } from 'react';
import { Card, Empty } from 'antd';
import type {
  SimulationAgentStats,
  SimulationMedalThresholds,
  SimulationRatingPoint,
} from '../api';

interface ScoreTrajectoryChartProps {
  agents: SimulationAgentStats[];
  thresholds?: SimulationMedalThresholds;
}

interface ChartPoint {
  x: number;
  y: number;
  timestamp?: string;
  episodeId: number;
  result: SimulationRatingPoint['result'];
}

interface ChartSeries {
  id: number;
  label: string;
  color: string;
  points: ChartPoint[];
  latest?: ChartPoint;
  games: number;
}

const COLORS = ['#d14343', '#3478c5', '#8b5cf6', '#0f9d75', '#d97706'];
const VIEWBOX_WIDTH = 920;
const VIEWBOX_HEIGHT = 400;
const PLOT = { left: 68, right: 36, top: 48, bottom: 50 };

const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const formatTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const labelForAgent = (agent: SimulationAgentStats, index: number) => {
  if (agent.submission_id === 55565346) return 'p46';
  if (agent.submission_id === 55555162) return 'p31';
  return `p${index + 1}`;
};

const buildLegacyTrajectory = (agent: SimulationAgentStats): SimulationRatingPoint[] => {
  const episodes = (agent.recent_episodes || [])
    .filter((episode) => !episode.is_system_check)
    .slice()
    .sort((a, b) => {
    const aTime = a.end_time || a.create_time || '';
    const bTime = b.end_time || b.create_time || '';
    return aTime.localeCompare(bTime) || a.id - b.id;
  });
  const finalScore = agent.score ?? agent.public_score;
  if (finalScore === undefined || finalScore === null || episodes.length === 0) return [];

  let scoreAfter = finalScore;
  const reversed: SimulationRatingPoint[] = [];
  for (const [index, episode] of episodes.map((item, itemIndex) => [itemIndex + 1, item] as const).reverse()) {
    reversed.push({
      episode_id: episode.id,
      game_number: index,
      timestamp: episode.end_time || episode.create_time,
      score: Number(scoreAfter.toFixed(1)),
      score_delta: episode.score_delta,
      result: episode.result,
    });
    scoreAfter = Number((scoreAfter - (episode.score_delta || 0)).toFixed(1));
  }
  return reversed.reverse();
};

const buildPath = (points: ChartPoint[]) =>
  points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

const calculateYAxisTicks = (min: number, max: number, targetCount: number = 6) => {
  if (max <= min) {
    const rounded = Math.round(min);
    return { yMin: rounded - 50, yMax: rounded + 50, ticks: [rounded - 50, rounded, rounded + 50] };
  }
  const rawStep = (max - min) / Math.max(1, targetCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;

  let stepMultiplier = 10;
  if (normalized <= 1.25) stepMultiplier = 1;
  else if (normalized <= 2.2) stepMultiplier = 2;
  else if (normalized <= 3.8) stepMultiplier = 2.5;
  else if (normalized <= 7.0) stepMultiplier = 5;

  const step = Math.max(1, Math.round(stepMultiplier * magnitude));
  const yMin = Math.floor(min / step) * step;
  const yMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let val = yMin; val <= yMax + 1e-5; val += step) {
    ticks.push(Math.round(val * 1e6) / 1e6);
  }
  return { yMin, yMax, ticks };
};

const integerTicks = (min: number, max: number, count: number) => {
  if (max <= min) return [Math.round(min)];
  const rawStep = (max - min) / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = Math.max(1, (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude);
  const first = Math.ceil(min / step) * step;
  const last = Math.ceil(max / step) * step;
  return Array.from(
    { length: Math.max(1, Math.floor((last - first) / step) + 1) },
    (_, index) => Math.round((first + index * step) * 1e6) / 1e6,
  );
};

const ScoreTrajectoryChart: React.FC<ScoreTrajectoryChartProps> = ({ agents, thresholds }) => {
  const chart = useMemo(() => {
    const series = agents
      .map((agent, index) => {
        const systemCheckIds = new Set(
          (agent.recent_episodes || [])
            .filter((episode) => episode.is_system_check)
            .map((episode) => episode.id),
        );
        const trajectory = (agent.rating_trajectory?.length
          ? agent.rating_trajectory
          : buildLegacyTrajectory(agent)
        ).filter((point) => !systemCheckIds.has(point.episode_id));
        const points = trajectory
          .slice()
          .sort((a, b) => a.game_number - b.game_number)
          .map((point, pointIndex) => ({
            x: point.game_number || pointIndex + 1,
            y: point.score,
            timestamp: point.timestamp,
            episodeId: point.episode_id,
            result: point.result,
          }));
        return {
          id: agent.submission_id,
          label: labelForAgent(agent, index),
          color: COLORS[index % COLORS.length],
          points,
          latest: points[points.length - 1],
          games: agent.total_episodes - (agent.system_checks || 0) || points[points.length - 1]?.x || 0,
        } satisfies ChartSeries;
      })
      .filter((item) => item.points.length > 0);

    const allPoints = series.flatMap((item) => item.points);
    const cutoffValues = [thresholds?.silver_cutoff_score, thresholds?.bronze_cutoff_score].filter(
      (value): value is number => value !== undefined && value !== null,
    );
    if (allPoints.length === 0) {
      return {
        series,
        xMin: 0,
        xMax: 10,
        yMin: 0,
        yMax: 100,
        xTicks: [0, 5, 10],
        yTicks: [0, 50, 100],
        silverCutoff: thresholds?.silver_cutoff_score,
        bronzeCutoff: thresholds?.bronze_cutoff_score,
      };
    }

    const minGames = 0;
    const maxGames = Math.max(...allPoints.map((point) => point.x), ...series.map((item) => item.games));
    // 聚焦于有效竞争区间，底部分数下限收敛至天梯基准（600分），防止开局倒推异常压扁全图真实走势
    const effectiveMinScore = Math.max(600, Math.min(...allPoints.map((point) => point.y), ...cutoffValues));
    const maxScore = Math.max(...allPoints.map((point) => point.y), ...cutoffValues);
    // 右侧预留充足外边距，确保即使各 Agent 局数不同，终点右侧分数标签也能完整横向展示，绝不下沉压线
    const xPaddingRight = Math.max(72, maxGames * 0.08);
    const yTickInfo = calculateYAxisTicks(effectiveMinScore - 10, maxScore + 15, 6);

    return {
      series,
      xMin: 0,
      xMax: Math.max(10, maxGames + xPaddingRight),
      yMin: yTickInfo.yMin,
      yMax: yTickInfo.yMax,
      xTicks: integerTicks(0, Math.max(10, maxGames + xPaddingRight), 5),
      yTicks: yTickInfo.ticks,
      silverCutoff: thresholds?.silver_cutoff_score,
      bronzeCutoff: thresholds?.bronze_cutoff_score,
    };
  }, [agents, thresholds?.bronze_cutoff_score, thresholds?.silver_cutoff_score]);

  const plotWidth = VIEWBOX_WIDTH - PLOT.left - PLOT.right;
  const plotHeight = VIEWBOX_HEIGHT - PLOT.top - PLOT.bottom;
  const xScale = (value: number) =>
    PLOT.left + ((value - chart.xMin) / (chart.xMax - chart.xMin || 1)) * plotWidth;
  const yScale = (value: number) => {
    const clamped = Math.max(chart.yMin, Math.min(chart.yMax, value));
    return PLOT.top + (1 - (clamped - chart.yMin) / (chart.yMax - chart.yMin || 1)) * plotHeight;
  };
  const hasData = chart.series.length > 0;

  // 智能自适应空间感知避让算法（动态感知上下层级与相对位置，100% 杜绝重叠）
  const endPointLayouts = useMemo(() => {
    const validSeries = chart.series.filter((s) => s.latest);
    if (validSeries.length === 0) return [];

    const maxPlotX = Math.max(...validSeries.map((s) => xScale(s.latest!.x)));

    // 1. 初始方向决策：根据相对层级与位置确定最优朝向 (Top / Bottom / Right)
    const items = validSeries.map((s) => {
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
  }, [chart.series, chart.xMin, chart.xMax, chart.yMin, chart.yMax, plotWidth, plotHeight]);

  const renderCutoffLine = (value: number | undefined, color: string) => {
    if (value === undefined || value < chart.yMin || value > chart.yMax) return null;
    const y = yScale(value);
    return (
      <line
        key={`cutoff-line-${value}-${color}`}
        x1={PLOT.left}
        x2={VIEWBOX_WIDTH - PLOT.right}
        y1={y}
        y2={y}
        stroke={color}
        strokeDasharray="5 5"
        strokeWidth="1.2"
        strokeOpacity="0.8"
      />
    );
  };

  const renderCutoffBadge = (value: number | undefined, label: string, color: string) => {
    if (value === undefined || value < chart.yMin || value > chart.yMax) return null;
    const y = yScale(value);
    const text = `${label} ${formatNumber(value)}`;
    const badgeWidth = text.length * 7.2 + 14;
    const badgeHeight = 18;
    // 阈值标签保持在图表左侧
    const badgeX = PLOT.left + 8;
    const badgeY = y - badgeHeight / 2;

    return (
      <g key={`cutoff-badge-${label}`}>
        <rect
          x={badgeX}
          y={badgeY}
          width={badgeWidth}
          height={badgeHeight}
          rx="4"
          fill="#ffffff"
          stroke={color}
          strokeWidth="1"
          strokeOpacity="0.85"
        />
        <text
          x={badgeX + badgeWidth / 2}
          y={y + 3.5}
          textAnchor="middle"
          fontSize="11"
          fontWeight="600"
          fill={color}
        >
          {text}
        </text>
      </g>
    );
  };

  const renderLegend = () => {
    const width = 136;
    const rowHeight = 20;
    const height = 10 + chart.series.length * rowHeight;
    const x = VIEWBOX_WIDTH - PLOT.right - width - 8;
    const y = VIEWBOX_HEIGHT - PLOT.bottom - height - 8;
    return (
      <g key="chart-legend">
        {/* 紧凑、弱化背景边框的右下角 Legend */}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx="5"
          fill="#ffffff"
          fillOpacity="0.9"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        {chart.series.map((series, index) => {
          const rowY = y + 15 + index * rowHeight;
          const gamesText = `${series.games} games`;
          return (
            <g key={`legend-${series.id}`}>
              {/* 颜色标识短线 */}
              <line
                x1={x + 10}
                x2={x + 22}
                y1={rowY - 3.5}
                y2={rowY - 3.5}
                stroke={series.color}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* 代理代号 (p46 / p31) */}
              <text x={x + 28} y={rowY} fontSize="11" fontWeight="700" fill="#334155">
                {series.label}
              </text>
              {/* 分隔圆点 */}
              <text x={x + 52} y={rowY} fontSize="11" fill="#94a3b8">
                ·
              </text>
              {/* 场次数值（省略重复的 rating，保持精简） */}
              <text x={x + 60} y={rowY} fontSize="10.5" fontWeight="500" fill="#64748b">
                {gamesText}
              </text>
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <Card
      size="small"
      title=""
      style={{ marginTop: 16, borderRadius: 10, borderColor: '#e2e8f0' }}
      styles={{ body: { padding: '12px 16px 16px' } }}
    >
      {!hasData ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无轨迹数据"
          style={{ margin: '24px 0' }}
        />
      ) : (
        <>
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <svg
              viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
              role="img"
              aria-label="Pokémon TCG AI Battle — Final Submission Rating Progression"
              style={{ display: 'block', width: '100%', minWidth: 560, height: 'auto' }}
            >
              {/* 图表主标题（居中展示） */}
              <text
                x={VIEWBOX_WIDTH / 2}
                y="28"
                textAnchor="middle"
                fontSize="14.5"
                fontWeight="700"
                fill="#0f172a"
                letterSpacing="-0.2"
              >
                Pokémon TCG AI Battle — Final Submission Rating Progression
              </text>

              {/* 图表主绘图区域边框（柔和中性浅灰，降低视觉抢夺） */}
              <rect
                x={PLOT.left}
                y={PLOT.top}
                width={plotWidth}
                height={plotHeight}
                fill="#ffffff"
                stroke="#cbd5e1"
                strokeWidth="1"
              />

              {/* 水平网格线（淡化浅灰背景） */}
              {chart.yTicks.map((tick) => {
                const y = yScale(tick);
                return (
                  <g key={`y-${tick}`}>
                    <line x1={PLOT.left} x2={VIEWBOX_WIDTH - PLOT.right} y1={y} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                    <text x={PLOT.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#64748b">
                      {formatNumber(tick)}
                    </text>
                  </g>
                );
              })}

              {/* 垂直网格线（极淡背景参考线） */}
              {chart.xTicks.map((tick) => {
                const x = xScale(tick);
                return (
                  <g key={`x-${tick}`}>
                    <line x1={x} x2={x} y1={PLOT.top} y2={VIEWBOX_HEIGHT - PLOT.bottom} stroke="#f8fafc" strokeWidth="1" />
                    <text x={x} y={VIEWBOX_HEIGHT - PLOT.bottom + 20} textAnchor="middle" fontSize="11" fill="#64748b">
                      {formatNumber(tick)}
                    </text>
                  </g>
                );
              })}

              {/* 1. 先绘制参考虚线 (背景层：淡色辅助虚线) */}
              {renderCutoffLine(chart.silverCutoff, '#94a3b8')}
              {renderCutoffLine(chart.bronzeCutoff, '#d97706')}

              {/* 2. 绘制数据折线（精细化 1.5px 线宽，高数据密度下纯净平滑，去除 1000 个密集重叠圆点产生的毛边和粗重感） */}
              {chart.series.map((series) => (
                <g key={series.id}>
                  <path
                    d={buildPath(series.points.map((point) => ({ ...point, x: xScale(point.x), y: yScale(point.y) })))}
                    fill="none"
                    stroke={series.color}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {/* 仅在数据点稀疏（<= 60局）时渲染中间节点，1000局高密度时保持线条纯净细腻 */}
                  {series.points.length <= 60 &&
                    series.points.slice(0, -1).map((point, index) => (
                      <circle
                        key={`${series.id}-${point.episodeId}-${index}`}
                        cx={xScale(point.x)}
                        cy={yScale(point.y)}
                        r={1.8}
                        fill={series.color}
                      >
                        <title>
                          {`${series.label} · 第 ${point.x} 局 · ${point.y.toFixed(1)} 分 · ${point.result} · ${formatTime(point.timestamp)}`}
                        </title>
                      </circle>
                    ))}
                </g>
              ))}

              {/* 3. 在折线之上绘制参考线胶囊徽章 (左侧前景层，实体白色背景避免折线穿透) */}
              {renderCutoffBadge(chart.silverCutoff, 'Silver', '#64748b')}
              {renderCutoffBadge(chart.bronzeCutoff, 'Bronze', '#d97706')}

              {/* 4. 方案 1：错位就地标注（纯净无虚线、无大圆点） */}
              {endPointLayouts.map((item) => (
                <text
                  key={`score-label-${item.id}`}
                  x={item.textX}
                  y={item.textY}
                  textAnchor={item.textAnchor}
                  fontSize="13.5"
                  fontWeight="700"
                  fill={item.color}
                  stroke="#ffffff"
                  strokeWidth="3.5"
                  strokeLinejoin="round"
                  style={{ paintOrder: 'stroke fill' }}
                >
                  {item.scoreStr}
                </text>
              ))}

              {/* 5. 右下角精简 Legend */}
              {renderLegend()}

              {/* X 轴正式标签 */}
              <text x={PLOT.left + plotWidth / 2} y={VIEWBOX_HEIGHT - 12} textAnchor="middle" fontSize="12" fontWeight="600" fill="#475569">
                Games Played
              </text>
              {/* Y 轴正式标签 */}
              <text
                x="16"
                y={PLOT.top + plotHeight / 2}
                textAnchor="middle"
                fontSize="12"
                fontWeight="600"
                fill="#475569"
                transform={`rotate(-90 16 ${PLOT.top + plotHeight / 2})`}
              >
                Skill Rating
              </text>
            </svg>
          </div>
        </>
      )}
    </Card>
  );
};

export default ScoreTrajectoryChart;
