import React from 'react';
import { Alert, Card, Col, Row, Typography } from 'antd';
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
            {snapshot?.status.pending_count || 0} 个事件待发送
          </div>
        </Col>
      </Row>

      {snapshot?.status.last_error && (
        <Alert
          type="error"
          showIcon
          message="最近一次投递失败日志"
          description={snapshot.status.last_error}
          style={{ marginTop: 14 }}
        />
      )}
    </Card>
  );
};

export default DeliveryStatusTab;
