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
    <div className="archive-batch-bar" role="toolbar" aria-label="批量操作栏">
      <div className="archive-batch-info">
        <Text className="archive-batch-text">
          已选择 <span className="archive-batch-count">{selectedRowKeys.length}</span> 个版本
        </Text>
      </div>
      <Space size={8} className="archive-batch-actions">
        <Button
          size="middle"
          className="archive-batch-btn archive-batch-btn-clear"
          onClick={onClearSelection}
        >
          取消选择
        </Button>
        <Button
          size="middle"
          danger
          className="archive-batch-btn archive-batch-btn-delete"
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
