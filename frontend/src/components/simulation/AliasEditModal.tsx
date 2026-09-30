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
      className="app-modal"
      closable={false}
      title={(
        <DialogTitle
          icon={<TagOutlined style={{ color: '#007aff' }} />}
          title="设置 Agent 自定义别名"
          subtitle={`提交 #${subId} · 同步展示于天梯卡片与战报`}
          onClose={onClose}
        />
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
      <div style={{ paddingTop: 4 }}>
        <div style={{ fontSize: 12.5, color: '#8e8e93', marginBottom: 12 }}>
          设置专属代号（如 <code>p46</code>、<code>主力模型</code>），方便快速辨识。
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
