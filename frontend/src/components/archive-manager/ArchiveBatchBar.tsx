import React from 'react';
import { Button, Space, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { ArchiveEntry } from '../../api';

const { Text } = Typography;

interface ArchiveBatchBarProps {
  selectedRowKeys: React.Key[];
  selectedArchives: ArchiveEntry[];
  onClearSelection: () => void;
  onDeleteBatch: (archives: ArchiveEntry[]) => void;
}

export const ArchiveBatchBar: React.FC<ArchiveBatchBarProps> = ({
  selectedRowKeys,
  selectedArchives,
  onClearSelection,
  onDeleteBatch,
}) => {
  if (!selectedRowKeys.length) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 28,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: '#ffffff',
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.15)',
        border: '1px solid #d9d9d9',
        borderRadius: 24,
        padding: '8px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <Text strong>
        已选择 <span style={{ color: '#1677ff' }}>{selectedRowKeys.length}</span> 个归档版本
      </Text>
      <Space>
        <Button size="small" onClick={onClearSelection}>
          取消选择
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onDeleteBatch(selectedArchives)}
        >
          批量删除
        </Button>
      </Space>
    </div>
  );
};

export default ArchiveBatchBar;
