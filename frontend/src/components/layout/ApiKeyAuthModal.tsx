import React from 'react';
import { Checkbox, Input, Modal, Typography } from 'antd';

const { Paragraph } = Typography;

interface ApiKeyAuthModalProps {
  open: boolean;
  apiKey: string;
  rememberApiKey: boolean;
  authChecking: boolean;
  onApiKeyChange: (value: string) => void;
  onRememberApiKeyChange: (value: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const ApiKeyAuthModal: React.FC<ApiKeyAuthModalProps> = ({
  open,
  apiKey,
  rememberApiKey,
  authChecking,
  onApiKeyChange,
  onRememberApiKeyChange,
  onSubmit,
  onCancel,
}) => {
  return (
    <Modal
      title="请输入 API 访问密钥"
      open={open}
      onOk={onSubmit}
      onCancel={onCancel}
      confirmLoading={authChecking}
      okText="验证并保存"
      cancelText="稍后"
    >
      <Paragraph type="secondary">
        当前后端服务开启了安全访问鉴权，请输入您在环境配置中设置的 `HARVESTER_API_KEY`。
      </Paragraph>
      <Input.Password
        placeholder="请输入 X-Harvester-Key"
        value={apiKey}
        onChange={(e) => onApiKeyChange(e.target.value)}
        onPressEnter={onSubmit}
        style={{ marginBottom: 12 }}
      />
      <Checkbox checked={rememberApiKey} onChange={(e) => onRememberApiKeyChange(e.target.checked)}>
        在当前浏览器长期记住该访问密钥
      </Checkbox>
    </Modal>
  );
};

export default ApiKeyAuthModal;
