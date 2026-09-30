import React from 'react';
import { Button, Checkbox, Empty, Pagination, Spin, Tag, Typography } from 'antd';
import {
  ClockCircleOutlined,
  CloudDownloadOutlined,
  EyeOutlined,
  StarOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ScoredKernel } from '../../api';
import { kaggleAuthorUrl, kaggleKernelUrl, kaggleOwnerFromRef } from '../../kaggleUrls';
import CopyButton from '../CopyButton';
import { formatDate, MOBILE_PAGE_SIZE } from './kernelUtils';

const { Text } = Typography;

interface MobileKernelCardListProps {
  displayKernels: ScoredKernel[];
  mobileKernels: ScoredKernel[];
  loading: boolean;
  selectedRowKeys: React.Key[];
  archivedVersions: Map<string, number[]>;
  mobilePage: number;
  onPageChange: (page: number) => void;
  onToggleSelect: (ref: string, checked: boolean) => void;
  getScoreColor: (score?: number) => string;
  onShowVersions: (kernel: ScoredKernel) => void;
  onOpenArchive: (targets: ScoredKernel[]) => void;
}

export const MobileKernelCardList: React.FC<MobileKernelCardListProps> = ({
  displayKernels,
  mobileKernels,
  loading,
  selectedRowKeys,
  archivedVersions,
  mobilePage,
  onPageChange,
  onToggleSelect,
  getScoreColor,
  onShowVersions,
  onOpenArchive,
}) => {
  return (
    <div className="mobile-data-list" aria-label="Kernel 列表">
      {loading && !displayKernels.length ? (
        <div className="mobile-empty-state" style={{ padding: '60px 0', textAlign: 'center' }}>
          <Spin size="large" tip="正在载入 Kernel 列表..." />
        </div>
      ) : !displayKernels.length ? (
        <div className="mobile-empty-state">
          <Empty description="暂无 Kernel 数据" />
        </div>
      ) : (
        <Spin spinning={loading} tip="正在同步最新数据...">
      {mobileKernels.map((kernel) => {
        const owner = kaggleOwnerFromRef(kernel.ref);
        const archived = archivedVersions.get(kernel.ref);
        const selected = selectedRowKeys.includes(kernel.ref);
        return (
          <article className="mobile-data-card" key={kernel.ref}>
            <div className="mobile-data-card-head">
              <Checkbox
                checked={selected}
                aria-label={`选择 ${kernel.ref}`}
                onChange={(event) => onToggleSelect(kernel.ref, event.target.checked)}
              />
              <div className="mobile-data-card-title">
                <a className="kernel-title" href={kaggleKernelUrl(kernel.ref)} target="_blank" rel="noreferrer">
                  {kernel.title || kernel.ref}
                </a>
                <span className="kernel-ref-line">
                  <span className="kernel-ref">{kernel.ref}</span>
                  <CopyButton value={kernel.ref} label="复制 Kernel ref" />
                </span>
              </div>
              <span className="score-value" style={{ color: getScoreColor(kernel.public_score) }}>
                {kernel.public_score === undefined || kernel.public_score === null
                  ? '—'
                  : kernel.public_score.toFixed(4)}
              </span>
            </div>
            <div className="mobile-data-card-meta">
              <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer">
                <UserOutlined /> @{owner}
              </a>
              <span><StarOutlined /> {kernel.total_votes} 票</span>
              <span><ClockCircleOutlined /> {formatDate(kernel.last_run_time)}</span>
              {archived?.length ? (
                <Tag color="success">已归档 {archived.length} 个版本</Tag>
              ) : (
                <span>未归档</span>
              )}
            </div>
            <div className="mobile-data-card-actions">
              <Button icon={<EyeOutlined />} onClick={() => onShowVersions(kernel)}>
                版本历史
              </Button>
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={() => onOpenArchive([kernel])}
              >
                归档
              </Button>
            </div>
          </article>
        );
      })}
      {displayKernels.length > MOBILE_PAGE_SIZE && (
        <div className="mobile-list-footer">
          <Text type="secondary">总计：{displayKernels.length}</Text>
          <Pagination
            simple
            size="small"
            current={mobilePage}
            pageSize={MOBILE_PAGE_SIZE}
            total={displayKernels.length}
            showSizeChanger={false}
            onChange={onPageChange}
          />
        </div>
      )}
        </Spin>
      )}
    </div>
  );
};

export default MobileKernelCardList;
