import React from 'react';
import { Card, Statistic } from 'antd';
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
    <div className="metric-grid">
      <Card size="small" className="metric-card">
        <Statistic
          title="已加载 Kernel"
          value={kernelsCount}
          suffix="个"
          prefix={<CodeOutlined />}
        />
      </Card>
      <Card size="small" className="metric-card">
        <Statistic
          title="已有分数"
          value={scoredCount}
          suffix="个"
          prefix={<ThunderboltOutlined />}
        />
      </Card>
      <Card size="small" className="metric-card">
        <Statistic
          title="当前最佳"
          value={bestScore ?? '—'}
          precision={bestScore === null ? undefined : 4}
          prefix={<TrophyOutlined />}
        />
      </Card>
    </div>
  );
};

export default KernelMetricsCards;
