import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  Bell,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  Flame,
  HelpCircle,
  History,
  Layers,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Swords,
  TrendingUp,
  Webhook,
  Zap,
} from 'lucide-react';
import {
  api,
  type NotificationConfigUpdate,
  type NotificationSnapshot,
} from '../api';
import DialogTitle from './DialogTitle';

const { Text, Title, Paragraph } = Typography;

type EmailProvider = 'qq' | '163' | 'gmail' | 'outlook' | 'custom';

interface NotificationFormValues extends Omit<NotificationConfigUpdate, 'smtp_to'> {
  smtp_to_text?: string;
  email_provider?: EmailProvider;
}

const WEBHOOK_HELP = {
  feishu: {
    name: '飞书群机器人',
    badgeColor: 'blue',
    placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx',
    steps: [
      '在飞书电脑端群聊中，点击右上角「设置」→「群机器人」',
      '点击「添加机器人」→ 选择「自定义机器人」并命名',
      '复制生成的 Webhook 地址粘贴到下方（支持自动加密存储）',
    ],
  },
  wecom: {
    name: '企业微信群机器人',
    badgeColor: 'cyan',
    placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx',
    steps: [
      '在企业微信群中点击右上角「...」→「群机器人」',
      '添加「新机器人」，复制 Webhook 完整地址',
      '支持富文本卡片与 Markdown 消息渲染',
    ],
  },
  dingtalk: {
    name: '钉钉群机器人',
    badgeColor: 'geekblue',
    placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=xxxxxxxx',
    steps: [
      '在钉钉群中进入「群设置」→「智能群助手」→「添加机器人」',
      '选择「自定义机器人」，安全设置可选择自定义关键词（如：Kaggle）',
      '复制生成的 Webhook 地址粘贴到下方',
    ],
  },
  slack: {
    name: 'Slack Incoming Webhook',
    badgeColor: 'purple',
    placeholder: 'https://hooks.slack.com/services/T00/B00/XXXXXX',
    steps: [
      '进入 Slack App 管理后台创建 Incoming Webhooks',
      '选择要推送的通知频道（Channel）',
      '复制生成的 Webhook URL 填入下方',
    ],
  },
  ntfy: {
    name: 'ntfy 手机免费推送',
    badgeColor: 'orange',
    placeholder: 'https://ntfy.sh/your-secret-topic-name',
    steps: [
      '在手机应用商店下载「ntfy」App（或直接使用网页端）',
      '在 App 中订阅一个独一无二且不易被猜到的主题名称',
      '填写主题完整 URL（如 https://ntfy.sh/my-kaggle-12345），出分即时震动提醒',
    ],
  },
  generic: {
    name: '自定义 HTTP / 通用 Webhook',
    badgeColor: 'default',
    placeholder: 'https://your-server.com/api/kaggle-webhook',
    steps: [
      '准备一个能接收 HTTP POST 请求的 HTTPS 接口',
      '接收 JSON Payload 后返回 2xx HTTP 状态码即视为发送成功',
    ],
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
    steps: [
      '登录 QQ 邮箱网页版，进入「设置」→「账号与安全」→「安全设置」',
      '开启「POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务」',
      '点击「生成授权码」，按提示发送短信获取 16 位英文授权码（填入下方密码框）',
    ],
    passwordLabel: 'QQ 邮箱 SMTP 授权码',
  },
  '163': {
    label: '网易 163 邮箱',
    host: 'smtp.163.com',
    port: 465,
    security: 'ssl',
    steps: [
      '登录 163 邮箱网页版，打开「设置」→「POP3/SMTP/IMAP」',
      '开启「POP3/SMTP服务」，点击新增授权密码',
      '此处填写生成的专用授权密码，不可使用邮箱常规登录密码',
    ],
    passwordLabel: '163 邮箱专用授权密码',
  },
  gmail: {
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    security: 'starttls',
    steps: [
      '前往 Google 账号中心并开启「两步验证」',
      '进入「安全性」→「应用专用密码」生成 16 位应用密码',
      '复制专用密码填入下方密码框',
    ],
    passwordLabel: 'Google 应用专用密码',
  },
  outlook: {
    label: 'Outlook / Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    security: 'starttls',
    steps: [
      '确认 Microsoft 账户已开启两步验证',
      '生成并使用应用密码；组织或企业账户需管理员允许 SMTP 客户端提交',
    ],
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

export const NotificationCenter: React.FC = () => {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<NotificationFormValues>();
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('channels');
  const [previewType, setPreviewType] = useState<'sim' | 'score' | 'archive'>('sim');
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
  }, [form, message]);

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
        message.success('测试通知已成功投递！请检查对应群聊或邮箱收件箱。');
      } else {
        const errDetails = result.channels
          .filter((item) => !item.success)
          .map((item) => `${item.channel}：${item.message}`)
          .join('；');
        message.error(`部分通道投递失败：${errDetails || '未知错误'}`);
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

  const activeChannelsCount = (snapshot?.config.webhook_enabled ? 1 : 0) + (snapshot?.config.email_enabled ? 1 : 0);

  return (
    <>
      <Button
        className="notification-center-trigger"
        icon={<Bell size={15} strokeWidth={1.9} />}
        aria-label="通知中心"
        onClick={() => void showSettings()}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
      >
        <span>通知中心</span>
        {activeChannelsCount > 0 && (
          <Badge count={`${activeChannelsCount} 通道`} style={{ backgroundColor: '#10b981', fontSize: 11 }} />
        )}
      </Button>

      <Modal
        className="newapi-dialog notification-center-modal"
        title={(
          <DialogTitle onClose={() => setOpen(false)}>
            <Space align="center" size={8}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: '#fef2f2', display: 'grid', placeItems: 'center' }}>
                <Bell size={16} color="#ef4444" />
              </div>
              <span style={{ fontWeight: 800 }}>竞赛与系统通知中心</span>
            </Space>
          </DialogTitle>
        )}
        open={open}
        forceRender
        destroyOnHidden={false}
        closable={false}
        width={920}
        confirmLoading={saving}
        styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowX: 'hidden', overflowY: 'auto', padding: '16px 24px' } }}
        onCancel={() => setOpen(false)}
        footer={[
          <div key="footer-wrap" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b' }}>
              <ShieldCheck size={14} color="#10b981" />
              <span>凭据安全保护：{snapshot?.config.secret_storage === 'windows_dpapi' ? 'Windows DPAPI 加密' : '环境密钥加密'}</span>
            </div>
            <Space size={8}>
              <Button key="close" onClick={() => setOpen(false)}>关闭</Button>
              <Button
                key="test"
                icon={<Send size={14} />}
                loading={testing}
                disabled={!webhookEnabled && !emailEnabled}
                onClick={() => void testNotification()}
              >
                发送测试通知
              </Button>
              <Button
                key="save"
                type="primary"
                loading={saving}
                onClick={() => void saveConfig()}
                style={{ fontWeight: 600 }}
              >
                保存配置
              </Button>
            </Space>
          </div>,
        ]}
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          type="card"
          items={[
            {
              key: 'channels',
              label: (
                <Space size={6}>
                  <Webhook size={15} />
                  <span>推送通道配置</span>
                  {(webhookEnabled || emailEnabled) && <Tag color="green" style={{ margin: 0, padding: '0 4px', fontSize: 10 }}>已启用</Tag>}
                </Space>
              ),
              children: (
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
                            群机器人 Webhook（推荐：飞书 / 企业微信 / 钉钉 / ntfy）
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
                                  { value: 'feishu', label: '🕊️ 飞书群机器人' },
                                  { value: 'wecom', label: '💼 企业微信群机器人' },
                                  { value: 'dingtalk', label: '🎯 钉钉群机器人' },
                                  { value: 'slack', label: '💬 Slack Channel' },
                                  { value: 'ntfy', label: '📱 ntfy 手机推送' },
                                  { value: 'generic', label: '🌐 自定义通用 JSON' },
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
                          <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>💡 快速配置指引：</div>
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
                              extra={snapshot?.config.smtp_password_configured ? '密码已安全加密；留空表示不修改' : '⚠️ 请填写邮箱安全设置中生成的「SMTP 授权码」，不要填写网页登录密码'}
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
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>💡 邮箱授权码指引：</div>
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
                </Form>
              ),
            },
            {
              key: 'events',
              label: (
                <Space size={6}>
                  <Zap size={15} />
                  <span>通知触发事件</span>
                </Space>
              ),
              children: (
                <Card size="small" style={{ borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 12 }}>
                    订阅与触发策略
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f8fafc', borderRadius: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>📈 竞赛提交产生新出分</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>监控器检测到提交从 Pending 变为 Scored，立即解析 Public Leaderboard 分数并推送通知</div>
                      </div>
                      <Form.Item name="notify_on_score" valuePropName="checked" noStyle>
                        <Switch checkedChildren="开启" unCheckedChildren="关闭" defaultChecked />
                      </Form.Item>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f8fafc', borderRadius: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>📦 高分 Kernel 自动归档完成</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>定时自动归档命中设定的门槛分数并成功下载 Notebook 源代码与输出时触发推送</div>
                      </div>
                      <Form.Item name="notify_on_archive" valuePropName="checked" noStyle>
                        <Switch checkedChildren="开启" unCheckedChildren="关闭" defaultChecked />
                      </Form.Item>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f8fafc', borderRadius: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>⚠️ 检查失败与重试告警</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>当 Kaggle API 凭据失效、网络受阻或归档过程发生不可逆错误时即时告警</div>
                      </div>
                      <Form.Item name="notify_on_failure" valuePropName="checked" noStyle>
                        <Switch checkedChildren="开启" unCheckedChildren="关闭" defaultChecked />
                      </Form.Item>
                    </div>
                  </div>
                </Card>
              ),
            },
            {
              key: 'preview',
              label: (
                <Space size={6}>
                  <Eye size={15} />
                  <span>推送消息样式预览</span>
                </Space>
              ),
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      选择不同的事件场景，查看真实推送到飞书、企业微信或邮件的卡片格式：
                    </Text>
                    <Segmented
                      value={previewType}
                      onChange={(val) => setPreviewType(val as any)}
                      options={[
                        { label: '⚔️ 宝可梦战报', value: 'sim' },
                        { label: '📈 提交出分提醒', value: 'score' },
                        { label: '📦 自动归档通知', value: 'archive' },
                      ]}
                    />
                  </div>

                  {/* Mock Message Container */}
                  <div
                    style={{
                      background: '#0f172a',
                      borderRadius: 12,
                      padding: '20px 24px',
                      color: '#f8fafc',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: 13,
                      lineHeight: 1.6,
                      border: '1px solid #1e293b',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                    }}
                  >
                    {previewType === 'sim' && (
                      <div>
                        <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: 15, marginBottom: 8 }}>
                          【Pokemon TCG AI 对战实时战报】
                        </div>
                        <div style={{ color: '#4ade80', fontWeight: 700, marginBottom: 4 }}>
                          Agent p46 (Sub #55565346)
                        </div>
                        <div style={{ paddingLeft: 12, color: '#e2e8f0' }}>
                          • 天梯积分: <span style={{ color: '#facc15', fontWeight: 800 }}>858.1</span> 分 (第 580 名 | <span style={{ color: '#fb923c' }}>🥉 铜牌线内</span>)<br />
                          • 铜牌安全垫: <span style={{ color: '#4ade80', fontWeight: 700 }}>高于铜牌线 +19.0分</span><br />
                          • 战绩胜率: 52.9% (37胜 / 33负)<br />
                          • 最新战况: <span style={{ color: '#38bdf8' }}>vs AlphaPoke (845分) 胜利 +3.9分</span>
                        </div>
                        <Divider style={{ borderColor: '#334155', margin: '10px 0' }} />
                        <div style={{ color: '#94a3b8', fontSize: 12 }}>
                          奖牌线切分（总参赛队伍: 6,807 队）<br />
                          • 🥇 金牌线: 1131.9 分 (Top 23)<br />
                          • 🥈 银牌线: 917.4 分 (Top 340)<br />
                          • 🥉 铜牌线: 839.1 分 (Top 680)
                        </div>
                      </div>
                    )}

                    {previewType === 'score' && (
                      <div>
                        <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: 15, marginBottom: 8 }}>
                          🎉 Kaggle Harvester：提交已出分 (新纪录！)
                        </div>
                        <div style={{ color: '#e2e8f0', marginBottom: 4 }}>
                          • 竞赛项目: <span style={{ color: '#facc15' }}>biohub-cell-tracking-during-development</span><br />
                          • 提交说明: <span style={{ color: '#38bdf8' }}>exp-04-unet-transformer-ensemble</span><br />
                          • 最新得分: <span style={{ color: '#4ade80', fontWeight: 800, fontSize: 16 }}>0.8924</span> (历史最佳突破！🔥)<br />
                          • 提交时间: 2026-08-18 16:40:27（北京时间）
                        </div>
                      </div>
                    )}

                    {previewType === 'archive' && (
                      <div>
                        <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: 15, marginBottom: 8 }}>
                          📦 Kaggle Harvester：发现并归档新高分 Kernel
                        </div>
                        <div style={{ color: '#e2e8f0' }}>
                          • 竞赛项目: biohub-cell-tracking-during-development<br />
                          • 归档明细:<br />
                          &nbsp;&nbsp;✔ <span style={{ color: '#facc15' }}>dr-kaggle/cell-seg-baseline</span> · 得分: 0.8841 · 版本: v3<br />
                          &nbsp;&nbsp;✔ <span style={{ color: '#facc15' }}>grandmaster/fast-inference-fp16</span> · 得分: 0.8812 · 版本: v7<br />
                          • 本地存储: data/archives/... 已就绪（包含源码与依赖）
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ),
            },
            {
              key: 'status',
              label: (
                <Space size={6}>
                  <History size={15} />
                  <span>投递状态与记录</span>
                </Space>
              ),
              children: (
                <Card size="small" style={{ borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <Row gutter={[16, 16]}>
                    <Col span={12}>
                      <Text type="secondary" style={{ fontSize: 12 }}>上次成功投递时间</Text>
                      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4 }}>
                        {formatDate(snapshot?.status.last_sent_at)}
                      </div>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary" style={{ fontSize: 12 }}>待重试投递队列</Text>
                      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4, color: snapshot?.status.pending_count ? '#d97706' : '#16a34a' }}>
                        {snapshot?.status.pending_count || 0} 个事件待发送
                      </div>
                    </Col>
                  </Row>

                  {snapshot?.status.last_error && (
                    <Alert
                      type="error"
                      showIcon
                      message="最近一次投递失败日志"
                      description={snapshot.status.last_error}
                      style={{ marginTop: 14 }}
                    />
                  )}
                </Card>
              ),
            },
          ]}
        />
      </Modal>
    </>
  );
};

export default NotificationCenter;
