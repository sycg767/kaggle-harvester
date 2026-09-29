import React from 'react';
import { Button, Input, Modal, Space } from 'antd';
import { TagOutlined } from '@ant-design/icons';
import DialogTitle from '../DialogTitle';

interface AliasEditModalProps {
  open: boolean;
  onClose: () => void;
  subId: number | null;
  aliasValue: string;
  onChangeAliasValue: (v: string) => void;
  saving: boolean;
  onSave: () => Promise<void>;
}

export const AliasEditModal: React.FC<AliasEditModalProps> = ({
  open,
  onClose,
  subId,
  aliasValue,
  onChangeAliasValue,
  saving,
  onSave,
}) => {
  return (
    <Modal
      title={(
        <DialogTitle onClose={onClose}>
          <Space size={8} align="center">
            <TagOutlined style={{ color: '#2563eb' }} />
            <span style={{ fontWeight: 600, fontSize: 16 }}>设置 Agent 自定义别名</span>
          </Space>
        </DialogTitle>
      )}
      open={open}
      onCancel={onClose}
      width={420}
      zIndex={1250}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={saving}
          onClick={onSave}
        >
          保存别名
        </Button>,
      ]}
    >
      <div style={{ paddingTop: 10 }}>
        <div style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
          为提交 <code>#{subId}</code> 赋予专属代号（如 <code>p32</code>、<code>p46</code>、<code>主力模型</code> 等），将立即同步至全景天梯卡片、折线走势图与微信机器人战报：
        </div>
        <Input
          size="large"
          placeholder="例如: p32 / p46"
          value={aliasValue}
          onChange={(e) => onChangeAliasValue(e.target.value)}
          onPressEnter={onSave}
          autoFocus
        />
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>快捷建议：</span>
          {['p32', 'p46', 'p31', 'Agent-A', '主力模型'].map((sug) => (
            <Button
              key={sug}
              size="small"
              type="dashed"
              style={{ fontSize: 11 }}
              onClick={() => onChangeAliasValue(sug)}
            >
              {sug}
            </Button>
          ))}
        </div>
      </div>
    </Modal>
  );
};

export default AliasEditModal;
