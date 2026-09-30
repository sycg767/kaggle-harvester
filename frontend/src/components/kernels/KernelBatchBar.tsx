import React from 'react';
import { Button, Space, Typography } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import type { ScoredKernel } from '../../api';

const { Text } = Typography;

interface KernelBatchBarProps {
  selectedCount: number;
  selectedKernels: ScoredKernel[];
  onClearSelection: () => void;
  onBatchArchive: (kernels: ScoredKernel[]) => void;
}

export const KernelBatchBar: React.FC<KernelBatchBarProps> = ({
  selectedCount,
  selectedKernels,
  onClearSelection,
  onBatchArchive,
}) => {
  if (!selectedCount) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: '#ffffff',
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.15)',
        border: '1px solid #d9d9d9',
        borderRadius: 24,
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 12,
        maxWidth: 'calc(100vw - 24px)',
        width: 'max-content',
        boxSizing: 'border-box',
      }}
    >
      <Text strong>
        已选择 <span style={{ color: '#1677ff' }}>{selectedCount}</span> 个 Kernel
      </Text>
      <Space>
        <Button size="small" onClick={onClearSelection}>
          取消选择
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<CloudDownloadOutlined />}
          onClick={() => onBatchArchive(selectedKernels)}
        >
          批量归档
        </Button>
      </Space>
    </div>
  );
};

export default KernelBatchBar;
