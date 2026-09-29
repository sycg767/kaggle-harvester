import React from 'react';
import { Card, Statistic } from 'antd';
import {
  DatabaseOutlined,
  FolderOpenOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { formatBytes } from './archiveUtils';

interface ArchiveMetricsCardsProps {
  totalArchives: number;
  uniqueKernels: number;
  uniqueAuthors: number;
  totalSize: number;
}

export const ArchiveMetricsCards: React.FC<ArchiveMetricsCardsProps> = ({
  totalArchives,
  uniqueKernels,
  uniqueAuthors,
  totalSize,
}) => {
  return (
    <div className="metric-grid archive-metrics">
      <Card size="small" className="metric-card">
        <Statistic title="归档版本" value={totalArchives} prefix={<DatabaseOutlined />} />
      </Card>
      <Card size="small" className="metric-card">
        <Statistic title="唯一 Kernel" value={uniqueKernels} />
      </Card>
      <Card size="small" className="metric-card">
        <Statistic title="作者" value={uniqueAuthors} prefix={<UserOutlined />} />
      </Card>
      <Card size="small" className="metric-card">
        <Statistic title="本地占用" value={formatBytes(totalSize)} prefix={<FolderOpenOutlined />} />
      </Card>
    </div>
  );
};

export default ArchiveMetricsCards;
