import React from 'react';
import { Button, List, Space, Tag, Tooltip, Typography } from 'antd';
import {
  ClockCircleOutlined,
  HistoryOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type { AutoArchiveRunLog } from '../../api';
import {
  formatDate,
  formatDuration,
  renderRunOutcome,
} from './autoArchiveUtils';

const { Text } = Typography;

interface AutoArchiveLogsListProps {
  logs: AutoArchiveRunLog[];
  onSelectLog: (log: AutoArchiveRunLog) => void;
}

export const AutoArchiveLogsList: React.FC<AutoArchiveLogsListProps> = ({
  logs,
  onSelectLog,
}) => {
  return (
    <>
      <div className="dialog-section-heading">
        <HistoryOutlined />
        <Text strong>运行记录</Text>
        <Text type="secondary" className="dialog-section-hint">弹窗打开时每 5 秒更新</Text>
      </div>
      <List<AutoArchiveRunLog>
        className="auto-archive-log-list"
        size="small"
        dataSource={logs}
        pagination={{ pageSize: 5, hideOnSinglePage: true }}
        locale={{ emptyText: <Text type="secondary">定时任务尚未完成过检查</Text> }}
        renderItem={(log) => (
          <List.Item
            className="auto-archive-log-row"
            role="button"
            tabIndex={0}
            aria-label={`查看 ${formatDate(log.finished_at)} 的检查详情`}
            actions={[
              <Tooltip title="查看本次检查的 Kernel 明细" key="detail">
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
                  <Tag icon={log.trigger === 'scheduled' ? <ClockCircleOutlined /> : undefined}>
                    {log.trigger === 'scheduled' ? '定时' : '手动'}
                  </Tag>
                  {renderRunOutcome(log)}
                </Space>
              )}
              description={(
                <Space size={12} wrap className="auto-archive-log-summary">
                  <span>检查 <Text strong>{log.checked_count}</Text></span>
                  <span>命中 <Text strong>{log.matched_count}</Text></span>
                  <span>新增 <Text type={log.archived_count > 0 ? 'success' : undefined} strong>{log.archived_count}</Text></span>
                  <span>跳过 <Text>{log.skipped_count}</Text></span>
                  {log.failed_count > 0 && <span>失败 <Text type="danger" strong>{log.failed_count}</Text></span>}
                  <Text type="secondary">耗时 {formatDuration(log.duration_seconds)}</Text>
                  {!log.details_available && <Text type="secondary">仅汇总</Text>}
                </Space>
              )}
            />
          </List.Item>
        )}
      />
    </>
  );
};

export default AutoArchiveLogsList;
