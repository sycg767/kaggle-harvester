import React from 'react';
import {
  formatNumber,
  formatTime,
  buildPath,
  VIEWBOX_WIDTH,
  VIEWBOX_HEIGHT,
  PLOT,
  type ChartSeries,
} from './trajectoryMath';
import { computeEndPointLayouts } from './trajectoryLayout';

interface TrajectorySvgProps {
  chart: {
    series: ChartSeries[];
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    xTicks: number[];
    yTicks: number[];
    silverCutoff?: number;
    bronzeCutoff?: number;
  };
}

export const TrajectorySvg: React.FC<TrajectorySvgProps> = ({ chart }) => {
  const plotWidth = VIEWBOX_WIDTH - PLOT.left - PLOT.right;
  const plotHeight = VIEWBOX_HEIGHT - PLOT.top - PLOT.bottom;

  const xScale = (value: number) =>
    PLOT.left + ((value - chart.xMin) / (chart.xMax - chart.xMin || 1)) * plotWidth;
  const yScale = (value: number) => {
    const clamped = Math.max(chart.yMin, Math.min(chart.yMax, value));
    return PLOT.top + (1 - (clamped - chart.yMin) / (chart.yMax - chart.yMin || 1)) * plotHeight;
  };

  const endPointLayouts = computeEndPointLayouts(chart.series, xScale, yScale);

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
              <line
                x1={x + 10}
                x2={x + 22}
                y1={rowY - 3.5}
                y2={rowY - 3.5}
                stroke={series.color}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <text x={x + 28} y={rowY} fontSize="11" fontWeight="700" fill="#334155">
                {series.label}
              </text>
              <text x={x + 52} y={rowY} fontSize="11" fill="#94a3b8">
                ·
              </text>
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

        {/* 图表主绘图区域边框 */}
        <rect
          x={PLOT.left}
          y={PLOT.top}
          width={plotWidth}
          height={plotHeight}
          fill="#ffffff"
          stroke="#cbd5e1"
          strokeWidth="1"
        />

        {/* 水平网格线 */}
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

        {/* 垂直网格线 */}
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

        {/* 参考虚线 */}
        {renderCutoffLine(chart.silverCutoff, '#94a3b8')}
        {renderCutoffLine(chart.bronzeCutoff, '#d97706')}

        {/* 数据折线 */}
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

        {/* 参考线徽章 */}
        {renderCutoffBadge(chart.silverCutoff, 'Silver', '#64748b')}
        {renderCutoffBadge(chart.bronzeCutoff, 'Bronze', '#d97706')}

        {/* 错位就地标注 */}
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

        {/* 右下角 Legend */}
        {renderLegend()}

        {/* X 轴标签 */}
        <text x={PLOT.left + plotWidth / 2} y={VIEWBOX_HEIGHT - 12} textAnchor="middle" fontSize="12" fontWeight="600" fill="#475569">
          Games Played
        </text>
        {/* Y 轴标签 */}
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
  );
};

export default TrajectorySvg;
