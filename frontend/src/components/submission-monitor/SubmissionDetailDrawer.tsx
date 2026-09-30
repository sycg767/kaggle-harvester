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
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd';
import { HistoryOutlined, SearchOutlined } from '@ant-design/icons';
import type {
  SubmissionMonitorItem,
  SubmissionMonitorRunDetail,
  SubmissionMonitorRunLog,
} from '../../api';
import DialogTitle from '../DialogTitle';
import {
  formatDate,
  formatDuration,
  formatScore,
  renderItemState,
  renderRunOutcome,
  SummaryItem,
} from './submissionMonitorUtils';

const { Text } = Typography;

interface SubmissionDetailDrawerProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  selectedLog: SubmissionMonitorRunLog | null;
  runDetail: SubmissionMonitorRunDetail | null;
  narrowViewport: boolean;
  onClose: () => void;
}

export const SubmissionDetailDrawer: React.FC<SubmissionDetailDrawerProps> = ({
  open,
  loading,
  error,
  selectedLog,
  runDetail,
  narrowViewport,
  onClose,
}) => {
  const [detailSearch, setDetailSearch] = useState('');
  const [detailState, setDetailState] = useState<'all' | 'pending' | 'scored' | 'failed' | 'newly_scored'>('all');

  const detailItems = useMemo(() => {
    const query = detailSearch.trim().toLowerCase();
    return (runDetail?.items || []).filter((item) => {
      const state = item.state || (item.public_score == null ? 'pending' : 'scored');
      if (detailState === 'pending' && state !== 'pending') return false;
      if (detailState === 'scored' && (state !== 'scored' || item.newly_scored)) return false;
      if (detailState === 'failed' && state !== 'failed') return false;
      if (detailState === 'newly_scored' && !item.newly_scored) return false;
      if (!query) return true;
      return [
        item.ref,
        item.description,
        item.status,
        item.competition,
        item.submitted_by,
        item.submitted_by_ref,
        item.team_name,
        item.error_description,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [detailSearch, detailState, runDetail?.items]);

  const detailColumns: TableColumnsType<SubmissionMonitorItem> = [
    {
      title: '竞赛',
      dataIndex: 'competition',
      key: 'competition',
      width: 150,
      ellipsis: true,
      render: (value?: string) => value || '—',
    },
    {
      title: 'Public LB',
      key: 'score',
      width: 120,
      render: (_, item) => formatScore(item),
    },
    {
      title: 'ref',
      dataIndex: 'ref',
      key: 'ref',
      width: 120,
      render: (value: string) => <Text code>{value}</Text>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (value?: string) => value || '（无描述）',
    },
    {
      title: '提交人',
      key: 'submitted_by',
      width: 140,
      ellipsis: true,
      render: (_, item) => item.submitted_by || item.submitted_by_ref || '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string | undefined, item) => item.error_description ? (
        <Tooltip title={item.error_description}>
          <Tag color="error">{value || '失败'}</Tag>
        </Tooltip>
      ) : value || '—',
    },
    {
      title: '结果',
      key: 'state',
      width: 100,
      render: (_, item) => renderItemState(item),
    },
    {
      title: '提交时间',
      dataIndex: 'date',
      key: 'date',
      width: 180,
      render: (value?: string) => formatDate(value),
    },
    {
      title: '监测到出分',
      dataIndex: 'scored_at',
      key: 'scored_at',
      width: 180,
      render: (value?: string) => formatDate(value),
    },
  ];

  return (
    <Drawer
      className="app-drawer newapi-detail-drawer"
      title={(
        <DialogTitle
          icon={<HistoryOutlined style={{ color: '#007aff' }} />}
          title="提交检查详情"
          subtitle={formatDate(selectedLog?.finished_at)}
          onClose={onClose}
        />
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
          <div className="dialog-summary-grid" role="group" aria-label="本次检查汇总">
            <div className="dialog-summary-cell">
              <span className="dialog-summary-label">触发方式</span>
              <span className="dialog-summary-value">{selectedLog.trigger === 'scheduled' ? '定时检查' : '手动检查'}</span>
            </div>
            <div className="dialog-summary-cell">
              <span className="dialog-summary-label">完成时间</span>
              <span className="dialog-summary-value">{formatDate(selectedLog.finished_at)}</span>
            </div>
            <div className="dialog-summary-cell">
              <span className="dialog-summary-label">耗时</span>
              <span className="dialog-summary-value">{formatDuration(selectedLog.duration_seconds)}</span>
            </div>
            <div className="dialog-summary-cell">
              <span className="dialog-summary-label">检查条数</span>
              <span className="dialog-summary-value">{selectedLog.checked_count}</span>
            </div>
            <div className="dialog-summary-cell">
              <span className="dialog-summary-label">待出分 / 已出分 / 失败</span>
              <span className="dialog-summary-value">{selectedLog.pending_count} / {selectedLog.scored_count} / {selectedLog.failed_count}</span>
            </div>
            <div className="dialog-summary-cell">
              <span className="dialog-summary-label">新出分</span>
              <span className="dialog-summary-value">{selectedLog.newly_scored_count}</span>
            </div>
          </div>

          {selectedLog.error && (
            <Alert
              type="error"
              showIcon
              message="本次检查错误"
              description={selectedLog.error}
              style={{ marginTop: 16 }}
            />
          )}

          {!runDetail.log.details_available && (
            <Alert
              type="info"
              showIcon
              message="该记录创建于明细日志启用前，仅保留汇总数据。请再执行一次「立即检查」以生成可点击明细。"
              style={{ marginTop: 16 }}
            />
          )}

          {runDetail.log.details_available && (
            <>
              <Row gutter={[12, 12]} style={{ marginTop: 16, marginBottom: 12 }}>
                <Col xs={24} sm={16}>
                  <Input
                    aria-label="筛选提交明细"
                    allowClear
                    prefix={<SearchOutlined />}
                    value={detailSearch}
                    placeholder="筛选 ref、描述、提交人或状态"
                    onChange={(event) => setDetailSearch(event.target.value)}
                  />
                </Col>
                <Col xs={24} sm={8}>
                  <Select
                    aria-label="提交明细状态筛选"
                    value={detailState}
                    style={{ width: '100%' }}
                    onChange={setDetailState}
                    options={[
                      { value: 'all', label: '全部提交' },
                      { value: 'pending', label: '待出分' },
                      { value: 'scored', label: '已出分' },
                      { value: 'failed', label: '失败' },
                      { value: 'newly_scored', label: '新出分' },
                    ]}
                  />
                </Col>
              </Row>
              <div className="desktop-data-table">
                <Table<SubmissionMonitorItem>
                  size="small"
                  rowKey="ref"
                  columns={detailColumns}
                  dataSource={detailItems}
                  pagination={{
                    defaultPageSize: 10,
                    pageSizeOptions: [10, 25, 50],
                    showSizeChanger: true,
                    showTotal: (total) => `显示 ${total} / ${runDetail.items.length} 条提交`,
                  }}
                  scroll={{ x: 900 }}
                />
              </div>
              <div className="mobile-data-list auto-archive-detail-list">
                {!detailItems.length && <Empty description="没有符合条件的提交" />}
                {detailItems.map((item) => (
                  <article className="mobile-data-card" key={item.ref}>
                    <div className="mobile-data-card-head">
                      <div className="mobile-data-card-title">
                        <span className="kernel-title">{item.description || '（无描述）'}</span>
                        <span className="kernel-ref">ref {item.ref}</span>
                      </div>
                      <span className="score-value">{formatScore(item)}</span>
                    </div>
                    <div className="mobile-data-card-meta">
                      <span>{item.status || '—'}</span>
                      <span>{formatDate(item.date)}</span>
                      <span>监测到出分 {formatDate(item.scored_at)}</span>
                      <span>{item.submitted_by || item.submitted_by_ref || '提交人未知'}</span>
                      {renderItemState(item)}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      ) : null}
    </Drawer>
  );
};

export default SubmissionDetailDrawer;
