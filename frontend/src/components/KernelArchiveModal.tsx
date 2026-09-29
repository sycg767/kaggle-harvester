import React from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Modal,
  Progress,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { CloseCircleOutlined } from '@ant-design/icons';
import type { DefaultOptionType } from 'antd/es/select';
import type { ScoredKernel } from '../api';
import DialogTitle from './DialogTitle';

const { Text } = Typography;

export type ArchiveVersionChoice = 'best' | 'latest' | `version:${number}`;

interface KernelArchiveModalProps {
  open: boolean;
  archiveRunning: boolean;
  archiveCompleted: boolean;
  archiveTargets: ScoredKernel[];
  archiveVersionChoice: ArchiveVersionChoice;
  archiveVersionOptions: DefaultOptionType[];
  archiveVersionsLoading: boolean;
  archiveVersionsError: string;
  includeOutputs: boolean;
  archiveSuccesses: number;
  archiveFailures: string[];
  archiveProgress: number;
  onClose: () => void;
  onNavigateArchives: () => void;
  onRunArchive: () => void;
  onVersionChoiceChange: (val: ArchiveVersionChoice) => void;
  onIncludeOutputsChange: (val: boolean) => void;
}

export const KernelArchiveModal: React.FC<KernelArchiveModalProps> = ({
  open,
  archiveRunning,
  archiveCompleted,
  archiveTargets,
  archiveVersionChoice,
  archiveVersionOptions,
  archiveVersionsLoading,
  archiveVersionsError,
  includeOutputs,
  archiveSuccesses,
  archiveFailures,
  archiveProgress,
  onClose,
  onNavigateArchives,
  onRunArchive,
  onVersionChoiceChange,
  onIncludeOutputsChange,
}) => {
  return (
    <Modal
      title={(
        <DialogTitle
          disabled={archiveRunning}
          onClose={() => !archiveRunning && onClose()}
        >
          {archiveTargets.length > 1 ? `批量归档 ${archiveTargets.length} 个 Kernel` : '归档 Kernel'}
        </DialogTitle>
      )}
      open={open}
      closable={false}
      maskClosable={!archiveRunning}
      onCancel={() => !archiveRunning && onClose()}
      footer={
        archiveCompleted ? (
          <Space>
            <Button onClick={onClose}>关闭</Button>
            <Button type="primary" onClick={onNavigateArchives}>查看归档</Button>
          </Space>
        ) : (
          <Space>
            <Button disabled={archiveRunning} onClick={onClose}>取消</Button>
            <Button type="primary" loading={archiveRunning} onClick={onRunArchive}>开始归档</Button>
          </Space>
        )
      }
    >
      {!archiveRunning && !archiveCompleted ? (
        <>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="目标">{archiveTargets.length === 1 ? archiveTargets[0]?.ref : `${archiveTargets.length} 个 Kernel`}</Descriptions.Item>
            <Descriptions.Item label="版本">
              {archiveTargets.length === 1 ? (
                <Select
                  value={archiveVersionChoice}
                  onChange={(value) => onVersionChoiceChange(value as ArchiveVersionChoice)}
                  options={archiveVersionOptions}
                  loading={archiveVersionsLoading}
                  disabled={archiveVersionsLoading}
                  style={{ width: '100%' }}
                />
              ) : (
                '每个 Kernel 自动选择最佳公开分数版本；无分数时选择最新版本'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="包含输出"><Switch checked={includeOutputs} onChange={onIncludeOutputsChange} /></Descriptions.Item>
          </Descriptions>
          {archiveVersionsError && archiveTargets.length === 1 && (
            <Alert type="warning" showIcon message="历史版本列表读取失败，仍可使用自动选择最佳版本。" description={archiveVersionsError} style={{ marginTop: 12 }} />
          )}
          {includeOutputs && <Alert type="warning" showIcon message="输出文件可能显著增加下载时间与本地占用。" style={{ marginTop: 12 }} />}
        </>
      ) : (
        <div style={{ padding: '8px 0 4px' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text strong>{archiveCompleted ? '归档完成' : '正在归档'}</Text>
            <Text>{archiveSuccesses} 成功 · {archiveFailures.length} 失败</Text>
          </Space>
          <Progress percent={archiveProgress} status={archiveFailures.length ? 'exception' : archiveCompleted ? 'success' : 'active'} />
          {!!archiveFailures.length && (
            <Alert
              type="error"
              showIcon
              icon={<CloseCircleOutlined />}
              message="部分归档失败"
              description={archiveFailures.map((failure) => <div key={failure}>{failure}</div>)}
              style={{ marginTop: 12 }}
            />
          )}
        </div>
      )}
    </Modal>
  );
};
