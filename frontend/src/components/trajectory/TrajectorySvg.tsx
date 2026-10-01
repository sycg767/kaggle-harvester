import React, { useMemo, useState } from 'react';
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
import { findTrajectoryHit, type TrajectoryHit } from './trajectoryHover';

interface TrajectorySvgProps {
  chart: {
    series: ChartSeries[];
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    xTicks: number[];
    yTicks: number[];
    goldCutoff?: number;
    silverCutoff?: number;
    bronzeCutoff?: number;
  };
  title?: string;
}

export const TrajectorySvg: React.FC<TrajectorySvgProps> = ({ chart, title }) => {
  const [hover, setHover] = useState<{ chart: TrajectorySvgProps['chart']; hit: TrajectoryHit } | null>(null);
  const plotWidth = VIEWBOX_WIDTH - PLOT.left - PLOT.right;
  const plotHeight = VIEWBOX_HEIGHT - PLOT.top - PLOT.bottom;

  const xScale = (value: number) =>
    PLOT.left + ((value - chart.xMin) / (chart.xMax - chart.xMin || 1)) * plotWidth;
  const yScale = (value: number) => {
    const clamped = Math.max(chart.yMin, Math.min(chart.yMax, value));
    return PLOT.top + (1 - (clamped - chart.yMin) / (chart.yMax - chart.yMin || 1)) * plotHeight;
  };

  const endPointLayouts = computeEndPointLayouts(chart.series, xScale, yScale);
  const projectedSeries = useMemo(() => chart.series.map((series) => ({
    id: series.id,
    points: series.points.map((point) => ({ x: xScale(point.x), y: yScale(point.y) })),
  })), [chart]);

  const inspectPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    // Convert client coordinates after responsive scaling, browser zoom, and horizontal scrolling.
    const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const inPlot = cursor.x >= PLOT.left && cursor.x <= VIEWBOX_WIDTH - PLOT.right
      && cursor.y >= PLOT.top && cursor.y <= VIEWBOX_HEIGHT - PLOT.bottom;
    const hit = inPlot
      ? findTrajectoryHit(projectedSeries, cursor.x, cursor.y, 16 / Math.hypot(matrix.a, matrix.b))
      : null;
    setHover((previous) => {
      if (!hit) return null;
      if (previous?.chart === chart && previous.hit.seriesId === hit.seriesId && previous.hit.pointIndex === hit.pointIndex) return previous;
      return { chart, hit };
    });
  };

  // A refreshed snapshot must never display a point retained from the previous competition/data.
  const activeSeries = hover?.chart === chart ? chart.series.find((series) => series.id === hover.hit.seriesId) : undefined;
  const activePoint = activeSeries && hover ? activeSeries.points[hover.hit.pointIndex] : undefined;
  const renderPointTooltip = () => {
    if (!activeSeries || !activePoint) return null;
    const x = xScale(activePoint.x);
    const y = yScale(activePoint.y);
    const width = 244;
    const height = 124;
    const left = Math.max(PLOT.left + 4, Math.min(x + 14, VIEWBOX_WIDTH - PLOT.right - width - 4));
    const top = Math.max(PLOT.top + 4, Math.min(y - height - 12, VIEWBOX_HEIGHT - PLOT.bottom - height - 4));
    const result = { win: '胜', loss: '负', tie: '平', unknown: '结果未知' }[activePoint.result] || '结果未知';
    const delta = activePoint.scoreDelta;
    const change = delta != null && Number.isFinite(delta)
      ? `${delta > 0 ? '+' : ''}${formatNumber(delta)} 分`
      : '未记录';
    return (
      <g pointerEvents="none">
        <line x1={x} x2={x} y1={PLOT.top} y2={VIEWBOX_HEIGHT - PLOT.bottom} stroke={activeSeries.color} strokeOpacity="0.3" strokeDasharray="3 4" />
        <circle cx={x} cy={y} r="4" fill={activeSeries.color} stroke="#ffffff" strokeWidth="2" />
        <g role="tooltip" aria-label={`${activeSeries.label} 第 ${activePoint.x} 局，积分 ${activePoint.y}`}>
          <rect x={left} y={top} width={width} height={height} rx="7" fill="#ffffff" stroke={activeSeries.color} strokeOpacity="0.65" />
          <text x={left + 12} y={top + 22} fontSize="12" fontWeight="700" fill={activeSeries.color}>
            <title>{activeSeries.label}</title>
            {activeSeries.label.length > 18 ? `${activeSeries.label.slice(0, 17)}…` : activeSeries.label}
          </text>
          <text x={left + 12} y={top + 45} fontSize="11" fill="#334155">第 {formatNumber(activePoint.x)} 局 · 积分 {formatNumber(activePoint.y)}</text>
          <text x={left + 12} y={top + 66} fontSize="11" fill="#334155">{result} · 单局变化 {change}</text>
          <text x={left + 12} y={top + 87} fontSize="11" fill="#64748b">时间：{formatTime(activePoint.timestamp) || '未记录'}</text>
          <text x={left + 12} y={top + 108} fontSize="11" fill="#64748b">对局 #{activePoint.episodeId}</text>
        </g>
      </g>
    );
  };

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
    const maxTextLen = Math.max(
      ...chart.series.map((s) => `${s.label} · ${s.games} games`.length),
      14,
    );
    const width = Math.max(140, Math.round(maxTextLen * 7.2) + 38);
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
          fillOpacity="0.92"
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
              <text x={x + 28} y={rowY} fontSize="11">
                <tspan fontWeight="700" fill="#334155">{series.label}</tspan>
                <tspan fill="#94a3b8"> · </tspan>
                <tspan fontSize="10.5" fontWeight="500" fill="#64748b">{gamesText}</tspan>
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
        aria-label={title || 'Rating Progression'}
        onPointerMove={inspectPoint}
        onPointerDown={inspectPoint}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
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
          {title || 'Rating Progression'}
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
        {renderCutoffLine(chart.goldCutoff, '#eab308')}
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
            {series.points.length === 1 && (
              <circle cx={xScale(series.points[0].x)} cy={yScale(series.points[0].y)} r="3" fill={series.color} />
            )}
          </g>
        ))}

        {/* 参考线徽章 */}
        {renderCutoffBadge(chart.goldCutoff, 'Gold', '#a16207')}
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
        {renderPointTooltip()}
      </svg>
    </div>
  );
};

export default TrajectorySvg;
