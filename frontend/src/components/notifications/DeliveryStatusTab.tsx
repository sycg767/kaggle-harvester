import React from 'react';
import { Alert, Card, Col, Row, Table, Tag, Typography } from 'antd';
import type { NotificationSnapshot } from '../../api';
import { formatDate } from './notificationConstants';

const { Text } = Typography;

interface DeliveryStatusTabProps {
  snapshot: NotificationSnapshot | null;
}

export const DeliveryStatusTab: React.FC<DeliveryStatusTabProps> = ({ snapshot }) => {
  return (
    <Card size="small" style={{ borderRadius: 10, border: '1px solid #e2e8f0' }}>
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>上次成功投递时间</Text>
          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4 }}>
            {formatDate(snapshot?.status.last_sent_at)}
          </div>
        </Col>
        <Col span={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>待重试投递队列</Text>
          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4, color: snapshot?.status.pending_count ? '#d97706' : '#16a34a' }}>
            {snapshot ? `${snapshot.status.pending_count} 个事件待发送` : '尚未读取状态'}
          </div>
        </Col>
      </Row>

      {snapshot && !snapshot.status.worker_alive && snapshot.status.pending_count > 0 && <Alert type="warning" message="投递队列未运行，待发送事件仍保留在服务器。" style={{ marginTop: 14 }} />}

      {snapshot?.status.last_error && (
        <Alert
          type="error"
          showIcon
          message="最近一次投递失败日志"
          description={snapshot.status.last_error}
          style={{ marginTop: 14 }}
        />
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
        全部赛事 · 最近 200 条投递记录。自本次功能更新起记录；“已入队”是历史动作，实际待发送数量以上方队列为准。
      </Typography.Paragraph>
      <Table rowKey="id" size="small" dataSource={snapshot?.deliveries || []} scroll={{ x: 680 }} pagination={{ pageSize: 10, showSizeChanger: false }}
        locale={{ emptyText: '尚无投递记录' }} columns={[
          { title: '记录时间', dataIndex: 'recorded_at', render: value => formatDate(value), width: 155 },
          { title: '赛事 / 事件', render: (_, item) => <div style={{ overflowWrap: 'anywhere' }}>{item.competition || '全局'}<br /><Text type="secondary">{item.event}</Text><br /><Text type="secondary" style={{ fontSize: 11 }}>{item.event_id}</Text></div> },
          { title: '通道', dataIndex: 'channel', width: 80 },
          { title: '结果', render: (_, item) => <div><Tag color={item.state === 'sent' ? 'success' : item.state === 'failed' ? 'error' : 'default'}>{item.state === 'sent' ? '已投递' : item.state === 'failed' ? '投递失败' : '已入队'}</Tag>{item.attempts > 0 && <span>{item.attempts} 次尝试</span>}{item.error && <div style={{ color: '#b91c1c', overflowWrap: 'anywhere' }}>{item.error}</div>}</div> },
        ]} />
    </Card>
  );
};

export default DeliveryStatusTab;
