import React from 'react';
import {
  Card,
  Col,
  Form,
  type FormInstance,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { Bot, HelpCircle, Mail, Webhook } from 'lucide-react';
import type { NotificationSnapshot } from '../../api';
import {
  detectWebhookFormat,
  EMAIL_PRESETS,
  type EmailProvider,
  type NotificationFormValues,
  WEBHOOK_HELP,
} from './notificationConstants';

const { Text } = Typography;

interface ChannelConfigTabProps {
  form: FormInstance<NotificationFormValues>;
  snapshot: NotificationSnapshot | null;
  wechatEnabled: boolean;
  webhookEnabled: boolean;
  emailEnabled: boolean;
}

export const ChannelConfigTab: React.FC<ChannelConfigTabProps> = ({
  form,
  snapshot,
  wechatEnabled,
  webhookEnabled,
  emailEnabled,
}) => {
  const webhookFormat = Form.useWatch('webhook_format', form) ?? 'feishu';
  const emailProvider = Form.useWatch('email_provider', form) ?? 'qq';
  const webhookHelp = WEBHOOK_HELP[webhookFormat as keyof typeof WEBHOOK_HELP] || WEBHOOK_HELP.feishu;
  const emailPreset = emailProvider === 'custom' ? null : EMAIL_PRESETS[emailProvider];

  const applyEmailProvider = (provider: EmailProvider) => {
    if (provider === 'custom') return;
    const preset = EMAIL_PRESETS[provider];
    form.setFieldsValue({
      smtp_host: preset.host,
      smtp_port: preset.port,
      smtp_security: preset.security,
      smtp_username: form.getFieldValue('smtp_from')?.trim() || '',
    });
  };

  return (
    <>
      {/* Channel 0: WeChat ClawBot */}
      <Card
        size="small"
        style={{
          marginBottom: 16,
          borderRadius: 10,
          border: wechatEnabled ? '1px solid #86efac' : '1px solid #e2e8f0',
          background: wechatEnabled ? '#f8fdf9' : '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space size={10}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dcfce7', display: 'grid', placeItems: 'center' }}>
              <Bot size={18} color="#16a34a" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                微信 ClawBot 智能管家推送
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                官方长连接 · 实时将战报、出分与归档推送到您的手机微信
              </Text>
            </div>
          </Space>
          <Space>
            <Tag color="success">直达手机微信</Tag>
            <Form.Item name="wechat_enabled" valuePropName="checked" noStyle>
              <Switch checkedChildren="已开启" unCheckedChildren="已停用" defaultChecked />
            </Form.Item>
          </Space>
        </div>
      </Card>

      {/* Channel 1: Webhook */}
      <Card
        size="small"
        style={{
          marginBottom: 16,
          borderRadius: 10,
          border: webhookEnabled ? '1px solid #93c5fd' : '1px solid #e2e8f0',
          background: webhookEnabled ? '#f8fafd' : '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Space size={10}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eff6ff', display: 'grid', placeItems: 'center' }}>
              <Webhook size={18} color="#2563eb" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                群机器人 Webhook（飞书 / 企业微信 / 钉钉 / Slack / ntfy）
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                即时将战报、出分、归档等事件推送到工作群或手机客户端
              </Text>
            </div>
          </Space>
          <Space>
            {snapshot?.config.webhook_configured && <Tag color="success">凭据已加密保存</Tag>}
            <Form.Item name="webhook_enabled" valuePropName="checked" noStyle>
              <Switch checkedChildren="已开启" unCheckedChildren="已停用" />
            </Form.Item>
          </Space>
        </div>

        {webhookEnabled && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
            <Row gutter={14}>
              <Col xs={24} sm={8}>
                <Form.Item name="webhook_format" label="选择目标机器人协议" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: 'feishu', label: '飞书群机器人' },
                      { value: 'wecom', label: '企业微信群机器人' },
                      { value: 'dingtalk', label: '钉钉群机器人' },
                      { value: 'slack', label: 'Slack' },
                      { value: 'ntfy', label: 'ntfy 手机推送' },
                      { value: 'generic', label: '自定义通用 Webhook' },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={16}>
                <Form.Item
                  name="webhook_url"
                  label="粘贴机器人 Webhook URL 地址"
                  extra={snapshot?.config.webhook_configured ? '地址已加密保存；若不更换请保持留空' : '请完整粘贴，保留包含 token/key 的完整 URL'}
                  rules={[{
                    validator: (_, value) => (
                      value?.trim() || snapshot?.config.webhook_configured
                        ? Promise.resolve()
                        : Promise.reject(new Error('请粘贴机器人的 Webhook 地址'))
                    ),
                  }]}
                >
                  <Input.Password
                    autoComplete="off"
                    placeholder={snapshot?.config.webhook_configured ? '已安全保存；留空表示不修改' : webhookHelp.placeholder}
                    onChange={(event) => {
                      const detected = detectWebhookFormat(event.target.value);
                      if (detected) {
                        form.setFieldValue('webhook_format', detected);
                      }
                    }}
                  />
                </Form.Item>
              </Col>
            </Row>

            <div style={{ background: '#f1f5f9', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#475569' }}>
              <Space size={6} style={{ marginBottom: 4 }}>
                <HelpCircle size={14} color="#0284c7" />
                <span style={{ fontWeight: 700, color: '#0f172a' }}>快速配置指引：</span>
              </Space>
              <ol style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
                {webhookHelp.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </div>
          </div>
        )}
      </Card>

      {/* Channel 2: SMTP Email */}
      <Card
        size="small"
        style={{
          marginBottom: 16,
          borderRadius: 10,
          border: emailEnabled ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
          background: emailEnabled ? '#f9fdfa' : '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Space size={10}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f0fdf4', display: 'grid', placeItems: 'center' }}>
              <Mail size={18} color="#16a34a" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                SMTP 邮件通知（QQ / 163 / Gmail / Outlook）
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                通过邮箱向个人或团队成员分发完整格式战报与出分日志
              </Text>
            </div>
          </Space>
          <Space>
            {snapshot?.config.smtp_password_configured && <Tag color="success">密码已加密保存</Tag>}
            <Form.Item name="email_enabled" valuePropName="checked" noStyle>
              <Switch checkedChildren="已开启" unCheckedChildren="已停用" />
            </Form.Item>
          </Space>
        </div>

        {emailEnabled && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
            <Row gutter={14}>
              <Col xs={24} sm={8}>
                <Form.Item name="email_provider" label="选择邮箱服务商" rules={[{ required: true }]}>
                  <Select
                    onChange={(value: EmailProvider) => applyEmailProvider(value)}
                    options={[
                      { value: 'qq', label: 'QQ 邮箱' },
                      { value: '163', label: '网易 163 邮箱' },
                      { value: 'outlook', label: 'Outlook / Office 365' },
                      { value: 'gmail', label: 'Gmail' },
                      { value: 'custom', label: '其他自定义 SMTP 服务器' },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="smtp_from"
                  label="发件人邮箱"
                  rules={[{ required: true, type: 'email', message: '请输入有效发件邮箱' }]}
                  extra="用于登录 SMTP 并发送邮件"
                >
                  <Input
                    placeholder={emailProvider === 'qq' ? '123456@qq.com' : emailProvider === '163' ? 'name@163.com' : 'name@example.com'}
                    onBlur={(event) => {
                      if (emailProvider !== 'custom' || !form.getFieldValue('smtp_username')) {
                        form.setFieldValue('smtp_username', event.target.value.trim());
                      }
                    }}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="smtp_to_text"
                  label="接收者邮箱地址"
                  rules={[{ required: true, message: '请输入至少一个收件人' }]}
                  extra="可填写自己；多个地址用逗号隔开"
                >
                  <Input placeholder="receiver1@example.com, receiver2@example.com" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={14}>
              <Col xs={24}>
                <Form.Item
                  name="smtp_password"
                  label={emailPreset?.passwordLabel || 'SMTP 授权码或应用专用密码'}
                  extra={snapshot?.config.smtp_password_configured ? '密码已安全加密；留空表示不修改' : '请填写邮箱安全设置中生成的「SMTP 授权码」，不要填写网页登录密码'}
                  rules={[{
                    validator: (_, value) => (
                      value || snapshot?.config.smtp_password_configured
                        ? Promise.resolve()
                        : Promise.reject(new Error('请填写邮箱授权码或应用密码'))
                    ),
                  }]}
                >
                  <Input.Password
                    autoComplete="new-password"
                    placeholder={snapshot?.config.smtp_password_configured ? '已安全保存；留空表示不修改' : '粘贴邮箱生成的 16 位 SMTP 授权码'}
                  />
                </Form.Item>
              </Col>
            </Row>

            {emailProvider === 'custom' && (
              <Row gutter={14} style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, marginBottom: 12 }}>
                <Col xs={24} sm={8}>
                  <Form.Item name="smtp_host" label="SMTP 服务器地址" rules={[{ required: true, message: '请输入 SMTP 服务器' }]}>
                    <Input placeholder="smtp.domain.com" />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={4}>
                  <Form.Item name="smtp_port" label="端口" rules={[{ required: true }]}>
                    <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={6}>
                  <Form.Item name="smtp_security" label="加密方式" rules={[{ required: true }]}>
                    <Select options={[
                      { value: 'ssl', label: 'SSL / TLS (通常 465)' },
                      { value: 'starttls', label: 'STARTTLS (通常 587)' },
                      { value: 'none', label: '无加密 (25)' },
                    ]} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item name="smtp_username" label="登录用户名">
                    <Input placeholder="留空默认使用发件邮箱" />
                  </Form.Item>
                </Col>
              </Row>
            )}

            <div style={{ background: '#f0fdf4', border: '1px solid #dcfce7', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#166534' }}>
              <Space size={6} style={{ marginBottom: 4 }}>
                <HelpCircle size={14} color="#16a34a" />
                <span style={{ fontWeight: 700, color: '#166534' }}>邮箱授权码指引：</span>
              </Space>
              <ol style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
                {(emailPreset?.steps || [
                  '登录邮箱网页端，进入安全设置页面开启 SMTP 服务',
                  '生成专用的应用授权密码并填入上方密码框',
                ]).map((step) => <li key={step}>{step}</li>)}
              </ol>
            </div>
          </div>
        )}
      </Card>
    </>
  );
};

export default ChannelConfigTab;
