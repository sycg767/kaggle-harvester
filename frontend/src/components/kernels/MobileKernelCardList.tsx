import React from 'react';
import { Button, Checkbox, Empty, Pagination, Spin, Typography } from 'antd';
import {
  CheckCircleOutlined,
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
    <div className="mobile-data-list kernel-mobile-list" aria-label="Kernel 列表">
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
              <article className="mobile-data-card kernel-mobile-card" key={kernel.ref}>
                {/* 1. 顶部行：Checkbox + 标题（最多2行） + 分数（右上固定，不被标题挤掉） */}
                <div className="kernel-mobile-card-top">
                  <div className="kernel-mobile-check-title">
                    <Checkbox
                      checked={selected}
                      aria-label={`选择 ${kernel.ref}`}
                      onChange={(event) => onToggleSelect(kernel.ref, event.target.checked)}
                    />
                    <a className="kernel-mobile-title" href={kaggleKernelUrl(kernel.ref)} target="_blank" rel="noreferrer">
                      {kernel.title || kernel.ref}
                    </a>
                  </div>
                  <div className="kernel-mobile-score" style={{ color: getScoreColor(kernel.public_score) }}>
                    <span className="kernel-mobile-score-val">
                      {kernel.public_score === undefined || kernel.public_score === null
                        ? '—'
                        : kernel.public_score.toFixed(4)}
                    </span>
                  </div>
                </div>

                {/* 2. 第二行：ref / slug（辅助信息，单行 ellipsis，低对比度） + 紧凑 Copy 按钮 */}
                <div className="kernel-mobile-ref-row">
                  <span className="kernel-mobile-ref" title={kernel.ref}>{kernel.ref}</span>
                  <CopyButton value={kernel.ref} label="复制 Kernel ref" />
                </div>

                {/* 3. 第三行：作者、投票、时间、本地状态（wrap 排布，间距适度） */}
                <div className="kernel-mobile-card-meta">
                  <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer" className="kernel-mobile-meta-link">
                    <UserOutlined style={{ fontSize: 11 }} />
                    <span>@{owner}</span>
                  </a>
                  <span className="kernel-mobile-meta-dot">·</span>
                  <span className="kernel-mobile-meta-item">
                    <StarOutlined style={{ fontSize: 11, color: '#f59e0b' }} />
                    <span>{kernel.total_votes} 票</span>
                  </span>
                  <span className="kernel-mobile-meta-dot">·</span>
                  <span className="kernel-mobile-meta-item">
                    <ClockCircleOutlined style={{ fontSize: 11 }} />
                    <span>{formatDate(kernel.last_run_time)}</span>
                  </span>
                  <span className="kernel-mobile-meta-dot">·</span>
                  {archived?.length ? (
                    <span className="kernel-status-chip is-success">
                      <CheckCircleOutlined style={{ fontSize: 10 }} />
                      <span>已归档 {archived.length} 版</span>
                    </span>
                  ) : (
                    <span className="kernel-status-chip is-neutral">未归档</span>
                  )}
                </div>

                {/* 4. 底部操作：双列 grid [版本历史] [归档] */}
                <div className="kernel-mobile-card-actions">
                  <Button
                    className="kernel-mobile-btn-versions"
                    icon={<EyeOutlined />}
                    onClick={() => onShowVersions(kernel)}
                  >
                    版本历史
                  </Button>
                  <Button
                    type="primary"
                    className="kernel-mobile-btn-archive"
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
            <div className="kernel-mobile-footer">
              <span className="kernel-mobile-total">总计 {displayKernels.length} 条</span>
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
