import React from 'react';
import {
  Alert,
  Button,
  Empty,
  Modal,
  Space,
  Spin,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import {
  CloudDownloadOutlined,
  ExportOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ScoredKernel, VersionInfo } from '../api';
import { kaggleKernelVersionUrl } from '../kaggleUrls';
import DialogTitle from './DialogTitle';

const { Text } = Typography;

interface KernelVersionModalProps {
  open: boolean;
  onClose: () => void;
  versionKernel: ScoredKernel | null;
  versions: VersionInfo[];
  versionsLoading: boolean;
  versionsError: string;
  onCheckNewVersions: (kernel: ScoredKernel) => void;
  onArchiveVersion: (kernel: ScoredKernel, versionNumber: number) => void;
  formatDate: (val?: string) => string;
  renderVersionStatus: (status?: string) => React.ReactNode;
}

export const KernelVersionModal: React.FC<KernelVersionModalProps> = ({
  open,
  onClose,
  versionKernel,
  versions,
  versionsLoading,
  versionsError,
  onCheckNewVersions,
  onArchiveVersion,
  formatDate,
  renderVersionStatus,
}) => {
  return (
    <Modal
      title={
        <DialogTitle onClose={onClose}>
          <Space>
            <span>{versionKernel ? `${versionKernel.ref} 版本历史` : '版本历史'}</span>
            {versionKernel && (
              <Tooltip title="检查是否有新版本；已缓存版本不会重复取分">
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={versionsLoading}
                  onClick={() => onCheckNewVersions(versionKernel)}
                >
                  检查新版本
                </Button>
              </Tooltip>
            )}
          </Space>
        </DialogTitle>
      }
      open={open}
      closable={false}
      width={780}
      footer={null}
      onCancel={onClose}
    >
      {versionsLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : versionsError ? (
        <Alert type="error" showIcon message="版本读取失败" description={versionsError} />
      ) : (
        <Table<VersionInfo>
          dataSource={versions}
          rowKey="version_number"
          size="small"
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="没有可用版本" /> }}
          scroll={{ x: 580 }}
          columns={[
            { title: '版本', dataIndex: 'version_number', width: 75, render: (value) => <Text code>v{value}</Text> },
            {
              title: '标题',
              dataIndex: 'title',
              ellipsis: true,
              render: (value: string, record: VersionInfo) => (
                <a
                  href={kaggleKernelVersionUrl(
                    versionKernel?.ref || '',
                    record.script_version_id,
                  )}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`在 Kaggle 打开版本 v${record.version_number}`}
                >
                  <Space size={4}>
                    <span>{value || `版本 v${record.version_number}`}</span>
                    <ExportOutlined style={{ fontSize: 11 }} />
                  </Space>
                </a>
              ),
            },
            { title: '状态', dataIndex: 'status', width: 110, render: renderVersionStatus },
            { title: '创建时间', dataIndex: 'date_created', width: 170, render: formatDate },
            { title: '分数', dataIndex: 'public_lb_numeric', width: 105, render: (value?: number) => value === undefined || value === null ? '—' : <Text strong>{value.toFixed(4)}</Text> },
            {
              title: '操作',
              width: 70,
              render: (_, record) => (
                <Tooltip title="归档此版本">
                  <Button
                    icon={<CloudDownloadOutlined />}
                    aria-label={`归档版本 v${record.version_number}`}
                    onClick={() => versionKernel && onArchiveVersion(versionKernel, record.version_number)}
                  />
                </Tooltip>
              ),
            },
          ]}
        />
      )}
    </Modal>
  );
};
