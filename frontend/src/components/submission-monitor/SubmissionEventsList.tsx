import React from 'react';
import { List, Space, Tag, Typography } from 'antd';
import type { SubmissionFailureEvent, SubmissionScoreEvent } from '../../api';
import { formatDate, formatScore } from './submissionMonitorUtils';

const { Text } = Typography;

interface SubmissionEventsListProps {
  events: SubmissionScoreEvent[];
  failureEvents?: SubmissionFailureEvent[];
}

export const SubmissionEventsList: React.FC<SubmissionEventsListProps> = ({ events, failureEvents }) => {
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
                  {formatScore(event)}
                </span>
                {event.score_type === 'private' && (
                  <Tag color="purple" style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}>
                    Private
                  </Tag>
                )}
                <span style={{ fontSize: 11.5, color: '#8e8e93', fontFamily: 'var(--font-mono)' }}>
                  ref {event.ref}
                </span>
                {event.competition && (
                  <span style={{ fontSize: 11.5, color: '#8e8e93' }}>
                    {event.competition}
                  </span>
                )}
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

      {failureEvents && failureEvents.length > 0 && (
        <>
          <div className="dialog-section-heading" style={{ marginTop: 20, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text strong style={{ fontSize: 13.5, color: '#cf1322' }}>最近提交失败</Text>
            <Text type="secondary" style={{ fontSize: 11.5 }}>执行错误或未出分异常</Text>
          </div>
          <List<SubmissionFailureEvent>
            size="small"
            dataSource={failureEvents}
            renderItem={(item) => (
              <div
                key={item.ref}
                style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: '#fff2f0',
                  border: '1px solid #ffccc7',
                  marginBottom: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag color="error" style={{ margin: 0 }}>
                      {item.status || 'FAILED'}
                    </Tag>
                    <span style={{ fontSize: 11.5, color: '#8e8e93', fontFamily: 'var(--font-mono)' }}>
                      ref {item.ref}
                    </span>
                    {item.competition && (
                      <span style={{ fontSize: 11.5, color: '#8e8e93' }}>
                        {item.competition}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11.5, color: '#8e8e93' }}>
                    {formatDate(item.date)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: '#1d1d1f',
                    lineHeight: 1.4,
                  }}
                  title={item.description}
                >
                  {item.description || '（无描述）'}
                </div>
                {item.error_description && (
                  <div
                    style={{
                      fontSize: 12,
                      color: '#cf1322',
                      background: '#fff',
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid #ffa39e',
                      fontFamily: 'var(--font-mono)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {item.error_description}
                  </div>
                )}
              </div>
            )}
            pagination={failureEvents.length > 5 ? { pageSize: 5, size: 'small' } : false}
          />
        </>
      )}
    </>
  );
};

export default SubmissionEventsList;
