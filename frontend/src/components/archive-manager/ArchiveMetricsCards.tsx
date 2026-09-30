import React from 'react';
import {
  DatabaseOutlined,
  FileTextOutlined,
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
    <div className="archive-metrics-strip" role="region" aria-label="归档指标概览">
      <div className="archive-metric-item">
        <div className="archive-metric-label">
          <DatabaseOutlined className="archive-metric-icon" />
          <span>归档版本</span>
        </div>
        <div className="archive-metric-value">
          {totalArchives}
        </div>
      </div>

      <div className="archive-metric-item">
        <div className="archive-metric-label">
          <FileTextOutlined className="archive-metric-icon" />
          <span>唯一 Kernel</span>
        </div>
        <div className="archive-metric-value">
          {uniqueKernels}
        </div>
      </div>

      <div className="archive-metric-item">
        <div className="archive-metric-label">
          <UserOutlined className="archive-metric-icon" />
          <span>作者</span>
        </div>
        <div className="archive-metric-value">
          {uniqueAuthors}
        </div>
      </div>

      <div className="archive-metric-item">
        <div className="archive-metric-label">
          <FolderOpenOutlined className="archive-metric-icon" />
          <span>本地占用</span>
        </div>
        <div className="archive-metric-value is-size">
          {formatBytes(totalSize)}
        </div>
      </div>
    </div>
  );
};

export default ArchiveMetricsCards;
