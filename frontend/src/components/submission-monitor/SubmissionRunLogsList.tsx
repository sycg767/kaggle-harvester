import React from 'react';
import { Button, List, Space, Tag, Tooltip, Typography } from 'antd';
import { ClockCircleOutlined, RightOutlined } from '@ant-design/icons';
import type { SubmissionMonitorRunLog } from '../../api';
import {
  formatDate,
  formatDuration,
  renderRunOutcome,
} from './submissionMonitorUtils';

const { Text } = Typography;

interface SubmissionRunLogsListProps {
  logs: SubmissionMonitorRunLog[];
  onSelectLog: (log: SubmissionMonitorRunLog) => void;
}

export const SubmissionRunLogsList: React.FC<SubmissionRunLogsListProps> = ({
  logs,
  onSelectLog,
}) => {
  return (
    <>
      <div className="dialog-section-heading" style={{ marginTop: 16 }}>
        <ClockCircleOutlined />
        <Text strong>运行记录</Text>
        <Text type="secondary" className="dialog-section-hint">点击查看本次检查到的提交明细</Text>
      </div>
      <List<SubmissionMonitorRunLog>
        className="auto-archive-log-list"
        size="small"
        dataSource={logs}
        pagination={{ pageSize: 5, hideOnSinglePage: true }}
        locale={{ emptyText: <Text type="secondary">尚未完成过检查</Text> }}
        renderItem={(log) => (
          <List.Item
            className="auto-archive-log-row"
            role="button"
            tabIndex={0}
            aria-label={`查看 ${formatDate(log.finished_at)} 的检查详情`}
            actions={[
              <Tooltip title="查看本次检查的提交明细" key="detail">
                <Button
                  type="text"
                  icon={<RightOutlined />}
                  aria-label={`打开 ${formatDate(log.finished_at)} 的检查详情`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectLog(log);
                  }}
                />
              </Tooltip>,
            ]}
            onClick={() => onSelectLog(log)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectLog(log);
              }
            }}
          >
            <List.Item.Meta
              title={(
                <Space size={6} wrap>
                  <Text strong>{formatDate(log.finished_at)}</Text>
                  <Tag>{log.trigger === 'scheduled' ? '定时' : '手动'}</Tag>
                  {renderRunOutcome(log)}
                </Space>
              )}
              description={(
                <Space size={12} wrap>
                  <span>检查 <Text strong>{log.checked_count}</Text></span>
                  <span>待出分 <Text>{log.pending_count}</Text></span>
                  <span>已出分 <Text>{log.scored_count}</Text></span>
                  <span>失败 <Text type={log.failed_count > 0 ? 'danger' : undefined}>{log.failed_count}</Text></span>
                  <span>新出分 <Text type={log.newly_scored_count > 0 ? 'success' : undefined} strong>{log.newly_scored_count}</Text></span>
                  <Text type="secondary">耗时 {formatDuration(log.duration_seconds)}</Text>
                  {log.details_available === false && <Text type="secondary">仅汇总</Text>}
                </Space>
              )}
            />
          </List.Item>
        )}
      />
    </>
  );
};

export default SubmissionRunLogsList;
