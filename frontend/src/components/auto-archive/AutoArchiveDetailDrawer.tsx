import React, { useMemo, useState } from 'react';
import {
  Alert,
  Col,
  Drawer,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Table,
} from 'antd';
import { HistoryOutlined, SearchOutlined } from '@ant-design/icons';
import type { AutoArchiveRunDetail, AutoArchiveRunLog } from '../../api';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../../kaggleUrls';
import DialogTitle from '../DialogTitle';
import {
  autoArchiveDetailColumns,
  formatDate,
  formatDuration,
  renderCheckedAction,
  renderRunOutcome,
  SummaryItem,
} from './autoArchiveUtils';

interface AutoArchiveDetailDrawerProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  selectedLog: AutoArchiveRunLog | null;
  runDetail: AutoArchiveRunDetail | null;
  narrowViewport: boolean;
  onClose: () => void;
}

export const AutoArchiveDetailDrawer: React.FC<AutoArchiveDetailDrawerProps> = ({
  open,
  loading,
  error,
  selectedLog,
  runDetail,
  narrowViewport,
  onClose,
}) => {
  const [detailSearch, setDetailSearch] = useState('');
  const [detailAction, setDetailAction] = useState('all');

  const detailItems = useMemo(() => {
    const query = detailSearch.trim().toLowerCase();
    return (runDetail?.items || []).filter((item) => {
      if (detailAction !== 'all' && item.action !== detailAction) return false;
      if (!query) return true;
      return [item.ref, item.title, item.author]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [detailAction, detailSearch, runDetail?.items]);

  return (
    <Drawer
      className="newapi-detail-drawer"
      title={(
        <DialogTitle onClose={onClose}>
          <Space size={8} wrap>
            <HistoryOutlined />
            <span>检查详情</span>
            <span style={{ color: '#64748b' }}>{formatDate(selectedLog?.finished_at)}</span>
          </Space>
        </DialogTitle>
      )}
      closable={false}
      extra={selectedLog ? renderRunOutcome(selectedLog) : null}
      open={open}
      width={narrowViewport ? '100%' : 980}
      zIndex={1100}
      onClose={onClose}
    >
      {loading ? (
        <div style={{ padding: 64, textAlign: 'center' }}><Spin /></div>
      ) : error ? (
        <Alert type="error" showIcon message="运行明细读取失败" description={error} />
      ) : runDetail && selectedLog ? (
        <>
          <div className="auto-archive-summary-grid" role="group" aria-label="本次检查汇总">
            <SummaryItem label="触发方式">
              {selectedLog.trigger === 'scheduled' ? '定时检查' : '手动检查'}
            </SummaryItem>
            <SummaryItem label="完成时间" tabular>{formatDate(selectedLog.finished_at)}</SummaryItem>
            <SummaryItem label="耗时" tabular>{formatDuration(selectedLog.duration_seconds)}</SummaryItem>
            <SummaryItem label="检查 / 命中" tabular>
              {selectedLog.checked_count} / {selectedLog.matched_count}
            </SummaryItem>
            <SummaryItem label="新增 / 跳过" tabular>
              {selectedLog.archived_count} / {selectedLog.skipped_count}
            </SummaryItem>
            <SummaryItem label="失败" tabular>{selectedLog.failed_count}</SummaryItem>
          </div>

          {!runDetail.log.details_available && (
            <Alert
              type="info"
              showIcon
              message="该记录创建于详细日志启用前，仅保留汇总数据。"
              style={{ marginTop: 16 }}
            />
          )}

          {runDetail.log.details_available && (
            <>
              <Row gutter={[12, 12]} style={{ marginTop: 16, marginBottom: 12 }}>
                <Col xs={24} sm={16}>
                  <Input
                    aria-label="筛选检查明细"
                    allowClear
                    prefix={<SearchOutlined />}
                    value={detailSearch}
                    placeholder="筛选 Kernel、作者或 ref"
                    onChange={(event) => setDetailSearch(event.target.value)}
                  />
                </Col>
                <Col xs={24} sm={8}>
                  <Select
                    aria-label="检查明细处理结果筛选"
                    value={detailAction}
                    style={{ width: '100%' }}
                    onChange={setDetailAction}
                    options={[
                      { value: 'all', label: '全部处理结果' },
                      { value: 'not_matched', label: '未命中阈值' },
                      { value: 'archived', label: '新增归档' },
                      { value: 'skipped', label: '已处理 / 跳过' },
                      { value: 'failed', label: '处理失败' },
                    ]}
                  />
                </Col>
              </Row>
              <div className="desktop-data-table">
                <Table
                  size="small"
                  rowKey="ref"
                  columns={autoArchiveDetailColumns}
                  dataSource={detailItems}
                  pagination={{
                    defaultPageSize: 10,
                    pageSizeOptions: [10, 25, 50],
                    showSizeChanger: true,
                    showTotal: (total) => `显示 ${total} / ${runDetail.items.length} 个 Kernel`,
                  }}
                  scroll={{ x: 900 }}
                />
              </div>
              <div className="mobile-data-list auto-archive-detail-list">
                {!detailItems.length && <Empty description="没有符合条件的 Kernel" />}
                {detailItems.map((item) => {
                  const owner = kaggleOwnerFromRef(item.ref);
                  return (
                    <article className="mobile-data-card" key={item.ref}>
                      <div className="mobile-data-card-head">
                        <div className="mobile-data-card-title">
                          <a className="kernel-title" href={kaggleKernelUrl(item.ref)} target="_blank" rel="noreferrer">
                            {item.title || item.ref}
                          </a>
                          <span className="kernel-ref">{item.ref}</span>
                        </div>
                        <span className="score-value">
                          {item.public_score === undefined || item.public_score === null ? '—' : item.public_score.toFixed(4)}
                        </span>
                      </div>
                      <div className="mobile-data-card-meta">
                        <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer">@{item.author || owner}</a>
                        <span>{formatDate(item.last_run_time)}</span>
                        {item.version_number && <span>v{item.version_number}</span>}
                        {renderCheckedAction(item)}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : null}
    </Drawer>
  );
};

export default AutoArchiveDetailDrawer;
