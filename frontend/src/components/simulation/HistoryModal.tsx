import React from 'react';
import { Button, List, Modal, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import type { SimulationMonitorRunLog } from '../../types/api';
import { formatDate, formatDuration } from './utils';

const { Text } = Typography;

interface HistoryModalProps {
  open: boolean;
  onClose: () => void;
  logs: SimulationMonitorRunLog[];
  selectedLogId: string | null;
  logDetailLoading: boolean;
  onViewDetail: (logId: string) => Promise<void> | void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  open,
  onClose,
  logs,
  selectedLogId,
  logDetailLoading,
  onViewDetail,
}) => {
  return (
    <Modal
      title="模拟对战监控运行日志"
      open={open}
      onCancel={onClose}
      width={720}
      zIndex={1100}
      footer={null}
    >
      <List
        dataSource={logs}
        renderItem={(log) => (
          <List.Item
            key={log.id}
            actions={[
              log.details_available ? (
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  loading={logDetailLoading && selectedLogId === log.id}
                  onClick={() => void onViewDetail(log.id)}
                >
                  查看明细
                </Button>
              ) : null,
            ]}
          >
            <List.Item.Meta
              avatar={
                log.outcome === 'success' ? (
                  <CheckCircleOutlined style={{ color: '#10b981', fontSize: 18 }} />
                ) : log.outcome === 'partial' ? (
                  <ExclamationCircleOutlined style={{ color: '#f59e0b', fontSize: 18 }} />
                ) : (
                  <CloseCircleOutlined style={{ color: '#f43f5e', fontSize: 18 }} />
                )
              }
              title={
                <Space>
                  <Tag>{log.trigger === 'manual' ? '手动触发' : '定时调度'}</Tag>
                  <Text strong>{formatDate(log.started_at)}</Text>
                  <Text type="secondary">耗时: {formatDuration(log.duration_seconds)}</Text>
                </Space>
              }
              description={
                <div>
                  <span>追踪 {log.agent_count} 个代理，抓取 {log.total_episodes_found} 场对局</span>
                  {log.new_episodes_found > 0 && (
                    <Tag color="green" style={{ marginLeft: 6 }}>
                      +{log.new_episodes_found} 场新对局
                    </Tag>
                  )}
                  {log.error && <div style={{ color: '#f43f5e', fontSize: 12, marginTop: 4 }}>{log.error}</div>}
                </div>
              }
            />
          </List.Item>
        )}
      />
    </Modal>
  );
};

export default HistoryModal;
