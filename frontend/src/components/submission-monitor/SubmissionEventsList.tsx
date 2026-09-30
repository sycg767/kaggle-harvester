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
      <div className="dialog-section-heading" style={{ marginTop: 20, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text strong style={{ fontSize: 13.5 }}>最近新出分</Text>
        <Text type="secondary" style={{ fontSize: 11.5 }}>按 ref 去重，每个提交只通知一次</Text>
      </div>
      <List<SubmissionScoreEvent>
        size="small"
        dataSource={events}
        locale={{ emptyText: <Text type="secondary">尚无新出分事件</Text> }}
        renderItem={(event) => (
          <div
            key={event.ref}
            style={{
              padding: '10px 12px',
              borderRadius: 12,
              background: '#fbfbfd',
              border: '1px solid rgba(60, 60, 67, 0.08)',
              marginBottom: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#1d1d1f', fontVariantNumeric: 'tabular-nums' }}>
                  {event.public_score_display || event.public_score}
                </span>
                <span style={{ fontSize: 11.5, color: '#8e8e93', fontFamily: 'var(--font-mono)' }}>
                  ref {event.ref}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {event.status && (
                  <span className={`dialog-status-pill ${event.status.toLowerCase().includes('complete') || event.status.toLowerCase().includes('success') ? 'is-success' : 'is-default'}`}>
                    {event.status}
                  </span>
                )}
                <span style={{ fontSize: 11.5, color: '#8e8e93' }}>
                  {formatDate(event.date)}
                </span>
              </div>
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#4b5563',
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
              title={event.description}
            >
              {event.description || '（无描述）'}
            </div>
          </div>
        )}
        pagination={events.length > 5 ? { pageSize: 5, size: 'small' } : false}
      />
    </>
  );
};

export default SubmissionEventsList;
