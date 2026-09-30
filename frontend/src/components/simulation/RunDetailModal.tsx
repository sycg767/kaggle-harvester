import React, { useMemo } from 'react';
import { Card, Empty, Modal, Space, Spin, Table, Tag, Typography } from 'antd';
import { Activity, Swords } from 'lucide-react';
import type { SimulationMonitorRunDetail } from '../../types/api';
import { formatDate, formatDuration } from './utils';
import { getSideEpisodeColumns } from './sideEpisodeColumns';
import DialogTitle from '../DialogTitle';

const { Text } = Typography;

interface RunDetailModalProps {
  open: boolean;
  onClose: () => void;
  logDetail: SimulationMonitorRunDetail | null;
  loading: boolean;
}

export const RunDetailModal: React.FC<RunDetailModalProps> = ({
  open,
  onClose,
  logDetail,
  loading,
}) => {
  const sideEpisodeColumns = useMemo(() => getSideEpisodeColumns(), []);

  return (
    <Modal
      className="app-modal"
      closable={false}
      title={(
        <DialogTitle
          icon={<Swords size={17} color="#d97706" />}
          title="模拟对战检查明细"
          subtitle={logDetail ? `${logDetail.log.trigger === 'manual' ? '手动触发' : '定时调度'} · ${formatDate(logDetail.log.started_at)}` : '运行检查详细记录'}
          onClose={onClose}
        />
      )}
      open={open}
      onCancel={onClose}
      width={1000}
      zIndex={1150}
      footer={null}
      destroyOnClose
    >
      <Spin spinning={loading} tip="正在读取运行明细...">
        {logDetail ? (
          <div>
            <div className="dialog-summary-grid" style={{ marginTop: 0, marginBottom: 16 }}>
              <div className="dialog-summary-cell">
                <span className="dialog-summary-label">检查结果</span>
                <span className="dialog-summary-value">
                  {logDetail.log.outcome === 'success' ? (
                    <span className="dialog-status-pill is-success">成功</span>
                  ) : logDetail.log.outcome === 'partial' ? (
                    <span className="dialog-status-pill is-warning">部分完成</span>
                  ) : (
                    <span className="dialog-status-pill is-error">失败</span>
                  )}
                </span>
              </div>
              <div className="dialog-summary-cell">
                <span className="dialog-summary-label">开始时间</span>
                <span className="dialog-summary-value">{formatDate(logDetail.log.started_at)}</span>
              </div>
              <div className="dialog-summary-cell">
                <span className="dialog-summary-label">耗时</span>
                <span className="dialog-summary-value">{formatDuration(logDetail.log.duration_seconds)}</span>
              </div>
              <div className="dialog-summary-cell">
                <span className="dialog-summary-label">对局抓取</span>
                <span className="dialog-summary-value">抓取 {logDetail.log.total_episodes_found} / 新增 {logDetail.log.new_episodes_found}</span>
              </div>
              <div className="dialog-summary-cell">
                <span className="dialog-summary-label">代理数</span>
                <span className="dialog-summary-value">{logDetail.log.agent_count} 个</span>
              </div>
            </div>

            {logDetail.log.error ? (
              <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#dc2626', fontSize: 12.5, marginBottom: 16 }}>
                错误信息: {logDetail.log.error}
              </div>
            ) : null}

            {logDetail.agents.length === 0 ? (
              <Empty description="这次运行没有可用的代理明细" />
            ) : (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                {logDetail.agents.map((agent) => (
                  <Card
                    key={agent.submission_id}
                    size="small"
                    title={agent.description || agent.team_name || `提交 #${agent.submission_id}`}
                    extra={<Tag color="blue">提交 #{agent.submission_id}</Tag>}
                  >
                    <Space wrap size={[16, 8]} style={{ marginBottom: 12 }}>
                      <Text>队伍：<strong>{agent.team_name || '—'}</strong></Text>
                      <Text>总对局：<strong>{agent.total_episodes}</strong></Text>
                      <Text>胜/负/平：<strong>{agent.wins}/{agent.losses}/{agent.ties}</strong></Text>
                      <Text>胜率：<strong>{agent.win_rate.toFixed(1)}%</strong></Text>
                    </Space>
                    <Table
                      rowKey="id"
                      size="small"
                      bordered
                      pagination={false}
                      scroll={{ x: 650, y: 360 }}
                      columns={sideEpisodeColumns}
                      dataSource={agent.recent_episodes || []}
                      locale={{ emptyText: '本次运行没有返回对局记录' }}
                    />
                  </Card>
                ))}
              </Space>
            )}
          </div>
        ) : !loading ? (
          <Empty description="暂无运行明细" />
        ) : null}
      </Spin>
    </Modal>
  );
};

export default RunDetailModal;
