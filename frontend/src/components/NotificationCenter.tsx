import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { Bell, Mail, Send, Webhook } from 'lucide-react';
import {
  api,
  type NotificationConfigUpdate,
  type NotificationSnapshot,
} from '../api';
import DialogTitle from './DialogTitle';

const { Text } = Typography;

type EmailProvider = 'qq' | '163' | 'gmail' | 'outlook' | 'custom';

interface NotificationFormValues extends Omit<NotificationConfigUpdate, 'smtp_to'> {
  smtp_to_text?: string;
  email_provider?: EmailProvider;
}

const WEBHOOK_HELP = {
  generic: {
    placeholder: 'https://your-service.example.com/webhook',
    steps: ['准备一个能接收 HTTP POST 的 HTTPS 地址', '接口接收 JSON 后返回 2xx 状态码'],
  },
  feishu: {
    placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx',
    steps: ['打开飞书群，进入「设置 → 群机器人」', '添加「自定义机器人」，复制 Webhook 地址'],
  },
  dingtalk: {
    placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=xxxxxxxx',
    steps: ['打开钉钉群，进入「群设置 → 机器人」', '添加「自定义机器人」，复制 Webhook 地址'],
  },
  wecom: {
    placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx',
    steps: ['打开企业微信群，进入「群设置 → 群机器人」', '添加机器人，复制 Webhook 地址'],
  },
  slack: {
    placeholder: 'https://hooks.slack.com/services/XXX/YYY/ZZZ',
    steps: ['在 Slack 创建 Incoming Webhook App', '选择接收频道，复制 Webhook URL'],
  },
  ntfy: {
    placeholder: 'https://ntfy.sh/your-private-topic',
    steps: ['在 ntfy App 或网页订阅一个不易猜测的主题名', '填写该主题 URL，例如 https://ntfy.sh/主题名'],
  },
} as const;

const EMAIL_PRESETS: Record<Exclude<EmailProvider, 'custom'>, {
  label: string;
  host: string;
  port: number;
  security: 'starttls' | 'ssl';
  steps: string[];
  passwordLabel: string;
}> = {
  qq: {
    label: 'QQ 邮箱',
    host: 'smtp.qq.com',
    port: 465,
    security: 'ssl',
    steps: ['登录 QQ 邮箱网页版，打开「设置 → 账号与安全 → 安全设置」', '开启 SMTP 服务并生成授权码；这里填写授权码，不是 QQ 密码'],
    passwordLabel: 'QQ 邮箱授权码',
  },
  '163': {
    label: '网易 163 邮箱',
    host: 'smtp.163.com',
    port: 465,
    security: 'ssl',
    steps: ['登录 163 邮箱网页版，打开「设置 → POP3/SMTP/IMAP」', '开启 SMTP 服务并生成授权密码；这里填写授权密码，不是邮箱登录密码'],
    passwordLabel: '163 邮箱授权密码',
  },
  gmail: {
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    security: 'starttls',
    steps: ['Google 账号先开启两步验证', '在「安全性 → 应用专用密码」生成 16 位密码，填写到这里'],
    passwordLabel: 'Google 应用专用密码',
  },
  outlook: {
    label: 'Outlook / Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    security: 'starttls',
    steps: ['确认账户或组织已允许 SMTP AUTH', '开启两步验证后使用应用密码；组织账户可能需要管理员放行'],
    passwordLabel: 'Microsoft 应用密码',
  },
};

const detectEmailProvider = (host: string): EmailProvider => {
  if (!host) return 'qq';
  const match = Object.entries(EMAIL_PRESETS).find(([, preset]) => preset.host === host);
  return (match?.[0] as EmailProvider | undefined) || 'custom';
};

const detectWebhookFormat = (url?: string): NotificationFormValues['webhook_format'] | null => {
  const raw = (url || '').trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname;
    if (host.endsWith('feishu.cn') || host.endsWith('larksuite.com')) return 'feishu';
    if (host.endsWith('dingtalk.com')) return 'dingtalk';
    if (host.endsWith('qyapi.weixin.qq.com') || (host.endsWith('weixin.qq.com') && raw.includes('webhook'))) {
      return 'wecom';
    }
    if (host === 'hooks.slack.com' || host.endsWith('.hooks.slack.com')) return 'slack';
    if (host === 'ntfy.sh' || host.endsWith('.ntfy.sh')) return 'ntfy';
  } catch {
    return null;
  }
  return null;
};

const resolveWebhookFormat = (
  format: NotificationFormValues['webhook_format'] | undefined,
  url?: string,
): NonNullable<NotificationFormValues['webhook_format']> => {
  const detected = detectWebhookFormat(url);
  if (detected) return detected;
  if (format && format !== 'generic') return format;
  // 本工具默认飞书；历史 generic 也按飞书展示，避免总落在「其他/通用 JSON」。
  return 'feishu';
};

const notificationFormFields = (data: NotificationSnapshot): NotificationFormValues => {
  const provider = detectEmailProvider(data.config.smtp_host);
  const preset = provider === 'custom' ? null : EMAIL_PRESETS[provider];
  return {
    ...data.config,
    webhook_format: resolveWebhookFormat(data.config.webhook_format),
    email_provider: provider,
    smtp_host: data.config.smtp_host || preset?.host || '',
    smtp_port: data.config.smtp_host ? data.config.smtp_port : preset?.port || 587,
    smtp_security: data.config.smtp_host ? data.config.smtp_security : preset?.security || 'starttls',
    webhook_url: '',
    smtp_password: '',
    smtp_to_text: data.config.smtp_to.join(', '),
    clear_webhook_url: false,
    clear_smtp_password: false,
  };
};

const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

const NotificationCenter: React.FC = () => {
  const [form] = Form.useForm<NotificationFormValues>();
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async (fillForm = false) => {
    try {
      const data = await api.getNotifications();
      setSnapshot(data);
      if (fillForm) form.setFieldsValue(notificationFormFields(data));
      return data;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '通知配置读取失败。');
      return null;
    }
  }, [form]);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(false), open ? 10_000 : 60_000);
    return () => window.clearInterval(timer);
  }, [load, open]);

  const showSettings = async () => {
    setOpen(true);
    setLoading(true);
    await load(true);
    setLoading(false);
  };

  const buildPayload = (values: NotificationFormValues): NotificationConfigUpdate => {
    const base = snapshot?.config;
    const smtpFrom = values.smtp_from ?? base?.smtp_from ?? '';
    const smtpUsernameRaw = values.smtp_username ?? base?.smtp_username ?? '';
    const smtpToText = values.smtp_to_text;
    const smtpTo = smtpToText !== undefined
      ? smtpToText.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean)
      : base?.smtp_to;
    return {
      notify_on_archive: values.notify_on_archive ?? base?.notify_on_archive,
      notify_on_failure: values.notify_on_failure ?? base?.notify_on_failure,
      notify_on_score: values.notify_on_score ?? base?.notify_on_score,
      webhook_enabled: values.webhook_enabled ?? base?.webhook_enabled,
      webhook_format: values.webhook_format ?? base?.webhook_format,
      email_enabled: values.email_enabled ?? base?.email_enabled,
      smtp_host: values.smtp_host ?? base?.smtp_host,
      smtp_port: values.smtp_port ?? base?.smtp_port,
      smtp_security: values.smtp_security ?? base?.smtp_security,
      smtp_username: (smtpUsernameRaw || smtpFrom || '').trim() || undefined,
      smtp_from: smtpFrom || undefined,
      smtp_to: smtpTo,
      webhook_url: values.webhook_url?.trim() || undefined,
      smtp_password: values.smtp_password || undefined,
      clear_webhook_url: values.clear_webhook_url,
      clear_smtp_password: values.clear_smtp_password,
    };
  };

  const saveConfig = async () => {
    const values = {
      ...form.getFieldsValue(true),
      ...(await form.validateFields()),
    } as NotificationFormValues;
    setSaving(true);
    try {
      const data = await api.updateNotifications(buildPayload(values));
      setSnapshot(data);
      form.setFieldsValue(notificationFormFields(data));
      message.success('通知配置已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '通知配置保存失败。');
    } finally {
      setSaving(false);
    }
  };

  const testNotification = async () => {
    let values: NotificationFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setTesting(true);
    try {
      const saved = await api.updateNotifications(buildPayload(values));
      setSnapshot(saved);
      const result = await api.testNotifications();
      if (result.success) {
        message.success('测试通知已发送');
      } else {
        message.error(
          result.channels
            .filter((item) => !item.success)
            .map((item) => `${item.channel}：${item.message}`)
            .join('；'),
        );
      }
      await load(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试通知发送失败。');
    } finally {
      setTesting(false);
    }
  };

  const webhookEnabled = Form.useWatch('webhook_enabled', form) ?? false;
  const emailEnabled = Form.useWatch('email_enabled', form) ?? false;
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
      <Button
        className="notification-center-trigger"
        icon={<Bell size={15} strokeWidth={1.9} />}
        aria-label="通知中心"
        onClick={() => void showSettings()}
      >
        通知中心
      </Button>

      <Modal
        className="newapi-dialog notification-center-modal"
        title={(
          <DialogTitle onClose={() => setOpen(false)}>
            <Space><Bell size={16} strokeWidth={1.9} />通知中心</Space>
          </DialogTitle>
        )}
        open={open}
        forceRender
        destroyOnClose={false}
        closable={false}
        width={900}
        confirmLoading={saving}
        styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowX: 'hidden', overflowY: 'auto' } }}
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="close" onClick={() => setOpen(false)}>关闭</Button>,
          <Button
            key="test"
            icon={<Send size={15} strokeWidth={1.9} />}
            loading={testing}
            disabled={!webhookEnabled && !emailEnabled}
            onClick={() => void testNotification()}
          >
            发送测试通知
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={saving}
            onClick={() => void saveConfig()}
          >
            保存配置
          </Button>,
        ]}
      >
        <Alert
          className="notification-choice-hint"
          type="info"
          showIcon
          message="全局通知通道"
          description="自动归档、提交出分等事件共用此处通道配置。有飞书/钉钉/企微群选 Webhook；否则用 SMTP 邮件。"
          style={{ marginBottom: 16 }}
        />

        <Form<NotificationFormValues>
          form={form}
          layout="vertical"
          disabled={loading || saving || testing}
          initialValues={{
            notify_on_archive: true,
            notify_on_failure: true,
            notify_on_score: true,
            webhook_enabled: false,
            webhook_format: 'feishu',
            email_enabled: false,
            email_provider: 'qq',
            smtp_host: 'smtp.qq.com',
            smtp_port: 465,
            smtp_security: 'ssl',
            smtp_username: '',
            smtp_from: '',
            smtp_to_text: '',
          }}
        >
          <div className="notification-event-row">
            <Form.Item name="notify_on_archive" valuePropName="checked" label="新增归档" style={{ marginBottom: 12 }}>
              <Switch checkedChildren="通知" unCheckedChildren="静默" />
            </Form.Item>
            <Form.Item name="notify_on_failure" valuePropName="checked" label="检查失败" style={{ marginBottom: 12 }}>
              <Switch checkedChildren="通知" unCheckedChildren="静默" />
            </Form.Item>
            <Form.Item name="notify_on_score" valuePropName="checked" label="提交出分" style={{ marginBottom: 12 }}>
              <Switch checkedChildren="通知" unCheckedChildren="静默" />
            </Form.Item>
            <Text type="secondary">事件开关与通道独立；无通道时即使事件开启也不会发送</Text>
          </div>

          <div className="notification-channel-section">
            <div className="notification-channel-heading">
              <Webhook size={16} strokeWidth={1.9} aria-hidden="true" />
              <Text strong>Webhook</Text>
              <Form.Item name="webhook_enabled" valuePropName="checked" noStyle>
                <Switch aria-label="启用 Webhook 通知" />
              </Form.Item>
              {snapshot?.config.webhook_configured && <Tag color="success">凭据已保存</Tag>}
            </div>
            {webhookEnabled && (
              <>
                <div className="notification-howto">
                  <Text strong>怎么获取地址</Text>
                  <ol>
                    {webhookHelp.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                </div>
                <Row gutter={12}>
                  <Col xs={24} sm={8}>
                    <Form.Item name="webhook_format" label="你使用的通知服务" rules={[{ required: true }]}>
                      <Select aria-label="Webhook 通知服务" options={[
                        { value: 'feishu', label: '飞书群机器人' },
                        { value: 'dingtalk', label: '钉钉群机器人' },
                        { value: 'wecom', label: '企业微信群机器人' },
                        { value: 'slack', label: 'Slack' },
                        { value: 'ntfy', label: 'ntfy 手机推送' },
                        { value: 'generic', label: '其他 / 通用 JSON' },
                      ]} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={16}>
                    <Form.Item
                      name="webhook_url"
                      label="粘贴机器人给你的 Webhook 地址"
                      extra={snapshot?.config.webhook_configured ? '地址已经安全保存；不修改时保持为空即可' : '完整粘贴，不要删除地址中的 key、token 或 access_token'}
                      rules={[{
                        validator: (_, value) => (
                          value?.trim() || snapshot?.config.webhook_configured
                            ? Promise.resolve()
                            : Promise.reject(new Error('请粘贴机器人提供的 Webhook 地址'))
                        ),
                      }]}
                    >
                      <Input.Password
                        aria-label="Webhook 地址"
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
              </>
            )}
          </div>

          <div className="notification-channel-section">
            <div className="notification-channel-heading">
              <Mail size={16} strokeWidth={1.9} aria-hidden="true" />
              <Text strong>SMTP 邮件</Text>
              <Form.Item name="email_enabled" valuePropName="checked" noStyle>
                <Switch aria-label="启用邮件通知" />
              </Form.Item>
              {snapshot?.config.smtp_password_configured && <Tag color="success">密码已保存</Tag>}
            </div>
            {emailEnabled && (
              <>
                <div className="notification-howto">
                  <Text strong>填写方法</Text>
                  <ol>
                    {(emailPreset?.steps || [
                      '向邮箱管理员获取 SMTP 服务器、端口和加密方式',
                      '密码栏优先填写 SMTP 授权码或应用专用密码',
                    ]).map((step) => <li key={step}>{step}</li>)}
                  </ol>
                </div>
                <Row gutter={12}>
                  <Col xs={24} sm={8}>
                    <Form.Item name="email_provider" label="你的邮箱" rules={[{ required: true }]}>
                      <Select
                        aria-label="邮箱服务商"
                        onChange={(value: EmailProvider) => applyEmailProvider(value)}
                        options={[
                          { value: 'qq', label: 'QQ 邮箱' },
                          { value: '163', label: '网易 163 邮箱' },
                          { value: 'outlook', label: 'Outlook / Microsoft 365' },
                          { value: 'gmail', label: 'Gmail' },
                          { value: 'custom', label: '其他邮箱（手动配置）' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Form.Item
                      name="smtp_from"
                      label="发件邮箱"
                      rules={[{ required: true, type: 'email', message: '请输入有效发件邮箱' }]}
                      extra="用这个邮箱发送通知"
                    >
                      <Input
                        aria-label="通知发件邮箱"
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
                      label="收件人邮箱"
                      rules={[{ required: true, message: '请输入至少一个收件人' }]}
                      extra="可以与发件邮箱相同；多个地址用逗号分隔"
                    >
                      <Input.TextArea aria-label="通知收件人" autoSize={{ minRows: 1, maxRows: 3 }} placeholder="receiver@example.com" />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24}>
                    <Form.Item
                      name="smtp_password"
                      label={emailPreset?.passwordLabel || 'SMTP 授权码或应用密码'}
                      extra={snapshot?.config.smtp_password_configured ? '授权码已经安全保存；不修改时保持为空即可' : '不要填写邮箱网页登录密码；到邮箱安全设置中生成授权码或应用密码'}
                      rules={[{
                        validator: (_, value) => (
                          value || snapshot?.config.smtp_password_configured
                            ? Promise.resolve()
                            : Promise.reject(new Error('请填写邮箱生成的授权码或应用密码'))
                        ),
                      }]}
                    >
                      <Input.Password
                        aria-label="邮箱授权码"
                        autoComplete="new-password"
                        placeholder={snapshot?.config.smtp_password_configured ? '已安全保存；留空表示不修改' : '粘贴邮箱生成的授权码'}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                {emailProvider === 'custom' && (
                  <Row gutter={12} className="notification-advanced-fields">
                    <Col xs={24} sm={8}>
                      <Form.Item name="smtp_host" label="SMTP 服务器" rules={[{ required: true, message: '请输入 SMTP 服务器' }]}>
                        <Input aria-label="SMTP 服务器" placeholder="smtp.example.com" />
                      </Form.Item>
                    </Col>
                    <Col xs={10} sm={4}>
                      <Form.Item name="smtp_port" label="端口" rules={[{ required: true }]}>
                        <InputNumber aria-label="SMTP 端口" min={1} max={65535} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={14} sm={8}>
                      <Form.Item name="smtp_security" label="连接安全" rules={[{ required: true }]}>
                        <Select aria-label="SMTP 连接安全" options={[
                          { value: 'starttls', label: 'STARTTLS' },
                          { value: 'ssl', label: 'SSL/TLS' },
                          { value: 'none', label: '无加密（仅限可信网络）' },
                        ]} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="smtp_username" label="SMTP 登录用户名" extra="留空时自动使用发件邮箱">
                        <Input aria-label="SMTP 登录用户名" autoComplete="username" />
                      </Form.Item>
                    </Col>
                  </Row>
                )}
              </>
            )}
          </div>

          <div className="notification-settings-footer">
            <Space size={8} wrap>
              <Tag>
                {snapshot?.config.secret_storage === 'windows_dpapi'
                  ? 'Windows 加密存储'
                  : snapshot?.config.secret_storage === 'environment'
                    ? '环境变量'
                    : '仅当前会话'}
              </Tag>
              {snapshot?.status.last_sent_at && (
                <Text type="secondary">最近发送 {formatDate(snapshot.status.last_sent_at)}</Text>
              )}
              {snapshot?.status.pending_count
                ? <Text type="warning">待重试 {snapshot.status.pending_count}</Text>
                : null}
            </Space>
          </div>
          {snapshot?.status.last_error && (
            <Alert
              type="error"
              showIcon
              message="最近一次通知发送失败"
              description={snapshot.status.last_error}
              style={{ marginTop: 12 }}
            />
          )}
        </Form>
      </Modal>
    </>
  );
};

export default NotificationCenter;
