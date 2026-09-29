import React from 'react';
import { List, Space, Tag, Typography } from 'antd';
import type { SubmissionScoreEvent } from '../../api';
import { formatDate } from './submissionMonitorUtils';

const { Text } = Typography;

interface SubmissionEventsListProps {
  events: SubmissionScoreEvent[];
}

export const SubmissionEventsList: React.FC<SubmissionEventsListProps> = ({ events }) => {
  return (
    <>
      <div className="dialog-section-heading" style={{ marginTop: 16 }}>
        <Text strong>最近新出分</Text>
        <Text type="secondary" className="dialog-section-hint">按 ref 去重，每个提交只通知一次</Text>
      </div>
      <List<SubmissionScoreEvent>
        size="small"
        dataSource={events}
        locale={{ emptyText: <Text type="secondary">尚无新出分事件</Text> }}
        renderItem={(event) => (
          <List.Item>
            <List.Item.Meta
              title={(
                <Space size={8} wrap>
                  <Text strong>{event.public_score_display || event.public_score}</Text>
                  <Text type="secondary">ref {event.ref}</Text>
                  {event.status && <Tag>{event.status}</Tag>}
                </Space>
              )}
              description={(
                <Space size={12} wrap>
                  <span>{event.description || '（无描述）'}</span>
                  <Text type="secondary">{formatDate(event.date)}</Text>
                </Space>
              )}
            />
          </List.Item>
        )}
        pagination={events.length > 5 ? { pageSize: 5 } : false}
      />
    </>
  );
};

export default SubmissionEventsList;
