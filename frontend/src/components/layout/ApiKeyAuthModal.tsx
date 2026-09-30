import React from 'react';
import { Button, Checkbox, Input, Modal } from 'antd';
import { KeyRound } from 'lucide-react';
import DialogTitle from '../DialogTitle';

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
      className="app-modal apikey-auth-modal"
      title={(
        <DialogTitle
          icon={<KeyRound size={18} color="#007aff" />}
          title="登录竞赛工作台"
          subtitle="使用管理员提供的访问码"
          onClose={onCancel}
        />
      )}
      open={open}
      onCancel={onCancel}
      closable={false}
      width={420}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button onClick={onCancel}>
            稍后
          </Button>
          <Button
            type="primary"
            loading={authChecking}
            disabled={!apiKey.trim()}
            onClick={onSubmit}
          >
            验证并进入
          </Button>
        </div>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: '#636366', lineHeight: 1.5 }}>
          请输入部署管理员提供的访问码。若由你自己部署，请使用部署时设置的应用访问密钥。
        </p>

        <Input.Password
          placeholder="请输入访问码"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          onPressEnter={onSubmit}
          autoFocus
          style={{ height: 42, borderRadius: 11 }}
        />

        <Checkbox
          checked={rememberApiKey}
          onChange={(e) => onRememberApiKeyChange(e.target.checked)}
          style={{ fontSize: 13, color: '#3a3a3c' }}
        >
          在当前浏览器记住访问码
        </Checkbox>
      </div>
    </Modal>
  );
};

export default ApiKeyAuthModal;
