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
    <div className="kernel-batch-bar" role="toolbar" aria-label="批量操作栏">
      <div className="kernel-batch-info">
        已选择 <span className="kernel-batch-count-num">{selectedCount}</span> 个 Kernel
      </div>
      <Space size={8}>
        <Button
          size="small"
          className="kernel-batch-btn-cancel"
          onClick={onClearSelection}
        >
          取消选择
        </Button>
        <Button
          size="small"
          type="primary"
          className="kernel-batch-btn-archive"
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
