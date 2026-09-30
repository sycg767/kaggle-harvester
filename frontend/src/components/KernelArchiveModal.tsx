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
import { Archive } from 'lucide-react';
import type { DefaultOptionType } from 'antd/es/select';
import type { ScoredKernel } from '../api';
import DialogTitle from './DialogTitle';

const { Text } = Typography;

export type ArchiveVersionChoice = 'best' | 'latest' | `version:${number}`;

interface KernelArchiveModalProps {
  open: boolean;
  archiveCompetition?: string;
  archiveSubmissionPending?: boolean;
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
  archiveCompetition,
  archiveSubmissionPending,
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
      className="app-modal"
      title={(
        <DialogTitle
          icon={<Archive size={17} color="#007aff" />}
          title={archiveTargets.length > 1 ? `批量归档 ${archiveTargets.length} 个 Kernel` : '归档 Kernel'}
          subtitle="保存到应用所在服务器：源码、元数据及可选输出；不代表已验证复现"
          disabled={archiveRunning}
          onClose={() => !archiveRunning && onClose()}
        />
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
            <Button type="primary" loading={archiveRunning} onClick={onRunArchive}>提交后台任务</Button>
          </Space>
        )
      }
    >
      <Alert type="info" message={`归档赛事：${archiveCompetition || '未指定'}`} description="已存在的版本会跳过，不会自动补下载输出或覆盖文件。" style={{ marginBottom: 12 }} />
      {archiveSubmissionPending && <Alert type="info" message="正在确认这次提交。参数已固定，重试会恢复同一任务，不会重复创建。" style={{ marginBottom: 12 }} />}
      {!archiveRunning && !archiveCompleted ? (
        <>
          <div className="settings-group" style={{ marginTop: 4, marginBottom: 12 }}>
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">归档目标</span>
                <span className="settings-row-desc" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {archiveTargets.length === 1 ? archiveTargets[0]?.ref : `${archiveTargets.length} 个 Kernel 待归档`}
                </span>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">版本选择</span>
                <span className="settings-row-desc">
                  {archiveTargets.length === 1 ? '指定要保存的历史或最新版本' : '每个 Kernel 自动选择最佳公开分数版本；无分数时选择最新版本'}
                </span>
              </div>
              {archiveTargets.length === 1 && (
                <div className="settings-row-control" style={{ minWidth: 200 }}>
                  <Select
                    value={archiveVersionChoice}
                    onChange={(value) => onVersionChoiceChange(value as ArchiveVersionChoice)}
                    options={archiveVersionOptions}
                    loading={archiveVersionsLoading}
                    disabled={archiveVersionsLoading || archiveSubmissionPending}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-title">包含输出文件</span>
                <span className="settings-row-desc">除源码外一并抓取模型、权重与结果文件</span>
              </div>
              <div className="settings-row-control">
                <Switch disabled={archiveSubmissionPending} checked={includeOutputs} onChange={onIncludeOutputsChange} />
              </div>
            </div>
          </div>
          {archiveVersionsError && archiveTargets.length === 1 && (
            <Alert type="warning" showIcon message="历史版本列表读取失败，仍可使用自动选择最佳版本。" description={archiveVersionsError} style={{ marginTop: 12 }} />
          )}
          {includeOutputs && <Alert type="warning" showIcon message="输出文件可能显著增加下载时间与服务器存储占用。" style={{ marginTop: 12 }} />}
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
