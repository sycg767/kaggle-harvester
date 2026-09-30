import React from 'react';
import {
  CodeOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
} from '@ant-design/icons';

interface KernelMetricsCardsProps {
  kernelsCount: number;
  scoredCount: number;
  bestScore: number | null;
}

const KernelMetricsCards: React.FC<KernelMetricsCardsProps> = ({
  kernelsCount,
  scoredCount,
  bestScore,
}) => {
  return (
    <div className="kernel-metrics-strip" role="region" aria-label="Kernel 指标概览">
      <div className="kernel-metric-item">
        <div className="kernel-metric-label">
          <CodeOutlined className="kernel-metric-icon" />
          <span>已加载 Kernel</span>
        </div>
        <div className="kernel-metric-value">
          {kernelsCount}
          <span className="kernel-metric-unit">个</span>
        </div>
      </div>

      <div className="kernel-metric-item">
        <div className="kernel-metric-label">
          <ThunderboltOutlined className="kernel-metric-icon" />
          <span>已有分数</span>
        </div>
        <div className="kernel-metric-value">
          {scoredCount}
          <span className="kernel-metric-unit">个</span>
        </div>
      </div>

      <div className="kernel-metric-item is-highlight">
        <div className="kernel-metric-label">
          <TrophyOutlined className="kernel-metric-icon" />
          <span>当前最佳</span>
        </div>
        <div className="kernel-metric-value best-score-value">
          {bestScore !== null ? bestScore.toFixed(4) : '—'}
        </div>
      </div>
    </div>
  );
};

export default KernelMetricsCards;
