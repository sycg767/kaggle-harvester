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
const VIEWBOX_HEIGHT = 380;
const PLOT = { left: 68, right: 24, top: 30, bottom: 54 };

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
  const episodes = (agent.recent_episodes || []).slice().sort((a, b) => {
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

const niceTicks = (min: number, max: number, count: number) => {
  if (max <= min) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
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
        const trajectory = agent.rating_trajectory?.length
          ? agent.rating_trajectory
          : buildLegacyTrajectory(agent);
        const points = trajectory
          .slice()
          .sort((a, b) => a.game_number - b.game_number)
          .map((point) => ({
            x: point.game_number,
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
          games: agent.total_episodes || points[points.length - 1]?.x || 0,
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

    const minGames = Math.min(...allPoints.map((point) => point.x));
    const maxGames = Math.max(...allPoints.map((point) => point.x), ...series.map((item) => item.games));
    const minScore = Math.min(...allPoints.map((point) => point.y), ...cutoffValues);
    const maxScore = Math.max(...allPoints.map((point) => point.y), ...cutoffValues);
    const xPaddingLeft = Math.max(1, (maxGames - minGames) * 0.03);
    const xPaddingRight = Math.max(18, (maxGames - minGames) * 0.09);
    const scoreRange = Math.max(20, maxScore - minScore);
    const yPadding = Math.max(8, scoreRange * 0.14);

    return {
      series,
      xMin: Math.max(0, minGames - xPaddingLeft),
      xMax: Math.max(minGames + 10, maxGames + xPaddingRight),
      yMin: Math.floor((minScore - yPadding) / 10) * 10,
      yMax: Math.ceil((maxScore + yPadding) / 10) * 10,
      xTicks: integerTicks(Math.max(0, minGames - xPaddingLeft), Math.max(minGames + 10, maxGames + xPaddingRight), 5),
      yTicks: niceTicks(Math.floor((minScore - yPadding) / 10) * 10, Math.ceil((maxScore + yPadding) / 10) * 10, 5),
      silverCutoff: thresholds?.silver_cutoff_score,
      bronzeCutoff: thresholds?.bronze_cutoff_score,
    };
  }, [agents, thresholds?.bronze_cutoff_score, thresholds?.silver_cutoff_score]);

  const plotWidth = VIEWBOX_WIDTH - PLOT.left - PLOT.right;
  const plotHeight = VIEWBOX_HEIGHT - PLOT.top - PLOT.bottom;
  const xScale = (value: number) =>
    PLOT.left + ((value - chart.xMin) / (chart.xMax - chart.xMin || 1)) * plotWidth;
  const yScale = (value: number) =>
    PLOT.top + (1 - (value - chart.yMin) / (chart.yMax - chart.yMin || 1)) * plotHeight;
  const hasData = chart.series.length > 0;

  // 计算末端分数标签的防重叠垂直偏移
  const labelOffsets = useMemo(() => {
    const offsets: Record<number, number> = {};
    const validSeries = chart.series.filter((s) => s.latest);
    if (validSeries.length <= 1) {
      validSeries.forEach((s) => {
        offsets[s.id] = 4;
      });
      return offsets;
    }

    const items = validSeries.map((s) => ({
      id: s.id,
      x: xScale(s.latest!.x),
      y: yScale(s.latest!.y),
      score: s.latest!.y,
    }));

    // 按 Y 坐标从上到下排序（屏幕 Y 越小越靠上）
    items.sort((a, b) => a.y - b.y);

    for (let i = 0; i < items.length; i += 1) {
      offsets[items[i].id] = 4; // 默认居中
    }

    for (let i = 0; i < items.length - 1; i += 1) {
      const current = items[i];
      const next = items[i + 1];
      const dy = next.y - current.y;
      const dx = Math.abs(next.x - current.x);

      // 如果两个标签垂直距离小于 22px 且水平距离接近
      if (dy < 22 && dx < 60) {
        offsets[current.id] = -5; // 上方标签向上微调
        offsets[next.id] = 13;   // 下方标签向下微调
      }
    }

    return offsets;
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
        strokeDasharray="6 5"
        strokeWidth="1.5"
      />
    );
  };

  const renderCutoffBadge = (value: number | undefined, label: string, color: string) => {
    if (value === undefined || value < chart.yMin || value > chart.yMax) return null;
    const y = yScale(value);
    const text = `${label} ${formatNumber(value)}`;
    const badgeWidth = text.length * 7.4 + 16;
    const badgeHeight = 18;
    const badgeX = PLOT.left + 8;
    const badgeY = y - badgeHeight / 2;

    return (
      <g key={`cutoff-badge-${label}`}>
        {/* 纯白实体胶囊框，浮于折线之上，确保文字 100% 不被线条穿透遮挡 */}
        <rect
          x={badgeX}
          y={badgeY}
          width={badgeWidth}
          height={badgeHeight}
          rx="4"
          fill="#ffffff"
          stroke={color}
          strokeWidth="1"
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
    const width = 198;
    const rowHeight = 22;
    const height = 12 + chart.series.length * rowHeight;
    const x = VIEWBOX_WIDTH - PLOT.right - width - 8;
    const y = VIEWBOX_HEIGHT - PLOT.bottom - height - 8;
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} rx="6" fill="#ffffff" fillOpacity="0.94" stroke="#cbd5e1" strokeWidth="1" />
        {chart.series.map((series, index) => {
          const rowY = y + 17 + index * rowHeight;
          const scoreText = series.latest ? series.latest.y.toFixed(1) : '—';
          const gamesText = `(${series.games} games)`;
          return (
            <g key={`legend-${series.id}`}>
              {/* 颜色标识线 */}
              <line x1={x + 10} x2={x + 26} y1={rowY - 4} y2={rowY - 4} stroke={series.color} strokeWidth="3" strokeLinecap="round" />
              {/* 代理代号 (p46 / p31) */}
              <text x={x + 32} y={rowY} fontSize="11" fontWeight="600" fill="#1e293b">
                {series.label}
              </text>
              {/* 分隔圆点 */}
              <text x={x + 58} y={rowY} fontSize="11" fill="#94a3b8">
                ·
              </text>
              {/* 积分数值 (严格左对齐在同一 X 坐标) */}
              <text x={x + 67} y={rowY} fontSize="11" fontWeight="600" fill={series.color}>
                {scoreText}
              </text>
              {/* 场次数值 (严格左对齐在同一 X 坐标) */}
              <text x={x + 108} y={rowY} fontSize="10.5" fill="#64748b">
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
      bodyStyle={{ padding: '10px 14px 14px' }}
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
              aria-label="各 Agent 每局评分变化折线图"
              style={{ display: 'block', width: '100%', minWidth: 560, height: 'auto' }}
            >
              <rect
                x={PLOT.left}
                y={PLOT.top}
                width={plotWidth}
                height={plotHeight}
                fill="#ffffff"
                stroke="#0f172a"
                strokeWidth="1"
              />

              {chart.yTicks.map((tick) => {
                const y = yScale(tick);
                return (
                  <g key={`y-${tick}`}>
                    <line x1={PLOT.left} x2={VIEWBOX_WIDTH - PLOT.right} y1={y} y2={y} stroke="#e5e7eb" />
                    <text x={PLOT.left - 10} y={y + 4} textAnchor="end" fontSize="12" fill="#475569">
                      {formatNumber(tick)}
                    </text>
                  </g>
                );
              })}

              {chart.xTicks.map((tick) => {
                const x = xScale(tick);
                return (
                  <g key={`x-${tick}`}>
                    <line x1={x} x2={x} y1={PLOT.top} y2={VIEWBOX_HEIGHT - PLOT.bottom} stroke="#f1f5f9" />
                    <text x={x} y={VIEWBOX_HEIGHT - PLOT.bottom + 22} textAnchor="middle" fontSize="12" fill="#475569">
                      {formatNumber(tick)}
                    </text>
                  </g>
                );
              })}

              {/* 1. 先绘制参考虚线 (背景层) */}
              {renderCutoffLine(chart.silverCutoff, '#64748b')}
              {renderCutoffLine(chart.bronzeCutoff, '#d97706')}

              {/* 2. 绘制数据折线与圆点 */}
              {chart.series.map((series) => (
                <g key={series.id}>
                  <path
                    d={buildPath(series.points.map((point) => ({ ...point, x: xScale(point.x), y: yScale(point.y) })))}
                    fill="none"
                    stroke={series.color}
                    strokeWidth="2.3"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {series.points.map((point, index) => (
                    <circle
                      key={`${series.id}-${point.episodeId}-${index}`}
                      cx={xScale(point.x)}
                      cy={yScale(point.y)}
                      r={index === series.points.length - 1 ? 4 : 2.2}
                      fill={series.color}
                    >
                      <title>
                        {`${series.label} · 第 ${point.x} 局 · ${point.y.toFixed(1)} 分 · ${point.result} · ${formatTime(point.timestamp)}`}
                      </title>
                    </circle>
                  ))}
                  {series.latest && (
                    <text
                      x={xScale(series.latest.x) + 7}
                      y={yScale(series.latest.y) + (labelOffsets[series.id] ?? 4)}
                      fontSize="13"
                      fontWeight="700"
                      fill={series.color}
                      stroke="#ffffff"
                      strokeWidth="3.5"
                      strokeLinejoin="round"
                      style={{ paintOrder: 'stroke fill' }}
                    >
                      {series.latest.y.toFixed(1)}
                    </text>
                  )}
                </g>
              ))}

              {/* 3. 在折线之上绘制参考线胶囊徽章 (前景层，实体白色背景完全覆盖穿过的折线) */}
              {renderCutoffBadge(chart.silverCutoff, 'Silver', '#64748b')}
              {renderCutoffBadge(chart.bronzeCutoff, 'Bronze', '#d97706')}

              {renderLegend()}

              <text x={PLOT.left + plotWidth / 2} y={VIEWBOX_HEIGHT - 10} textAnchor="middle" fontSize="13" fill="#334155">
                games played
              </text>
              <text
                x="16"
                y={PLOT.top + plotHeight / 2}
                textAnchor="middle"
                fontSize="13"
                fill="#334155"
                transform={`rotate(-90 16 ${PLOT.top + plotHeight / 2})`}
              >
                rating
              </text>
            </svg>
          </div>
        </>
      )}
    </Card>
  );
};

export default ScoreTrajectoryChart;
