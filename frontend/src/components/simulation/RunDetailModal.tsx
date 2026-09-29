import React, { useMemo } from 'react';
import { Alert, Card, Empty, Modal, Space, Spin, Table, Tag, Typography } from 'antd';
import type { SimulationMonitorRunDetail } from '../../types/api';
import { formatDate, formatDuration } from './utils';
import { getSideEpisodeColumns } from './sideEpisodeColumns';

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
      title="模拟对战检查明细"
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
            <Alert
              type={
                logDetail.log.outcome === 'success'
                  ? 'success'
                  : logDetail.log.outcome === 'partial'
                  ? 'warning'
                  : 'error'
              }
              showIcon
              style={{ marginBottom: 16 }}
              message={
                <Space wrap>
                  <span>{logDetail.log.trigger === 'manual' ? '手动检查' : '定时调度'}</span>
                  <Text>{formatDate(logDetail.log.started_at)}</Text>
                  <Text type="secondary">耗时 {formatDuration(logDetail.log.duration_seconds)}</Text>
                </Space>
              }
              description={
                <Space wrap>
                  <span>
                    本次抓取 {logDetail.log.total_episodes_found} 场，总计新增/补抓 {logDetail.log.new_episodes_found} 场
                  </span>
                  <span>代理数：{logDetail.log.agent_count}</span>
                  {logDetail.log.error ? <span>{logDetail.log.error}</span> : null}
                </Space>
              }
            />

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
