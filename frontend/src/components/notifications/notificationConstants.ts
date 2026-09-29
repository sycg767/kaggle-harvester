import type { NotificationConfigUpdate, NotificationSnapshot } from '../../api';

export type EmailProvider = 'qq' | '163' | 'gmail' | 'outlook' | 'custom';

export interface NotificationFormValues extends Omit<NotificationConfigUpdate, 'smtp_to'> {
  smtp_to_text?: string;
  email_provider?: EmailProvider;
}

export const WEBHOOK_HELP = {
  feishu: {
    name: '飞书群机器人',
    badgeColor: 'blue',
    placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx',
    steps: [
      '在飞书电脑端群聊中，点击右上角「设置」→「群机器人」',
      '点击「添加机器人」→ 选择「自定义机器人」并命名',
      '复制生成的 Webhook 地址粘贴到下方（系统自动加密存储）',
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

export const EMAIL_PRESETS: Record<Exclude<EmailProvider, 'custom'>, {
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
      '点击「生成授权码」，按提示获取 16 位授权码填入下方密码框',
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

export const detectEmailProvider = (host: string): EmailProvider => {
  if (!host) return 'qq';
  const match = Object.entries(EMAIL_PRESETS).find(([, preset]) => preset.host === host);
  return (match?.[0] as EmailProvider | undefined) || 'custom';
};

export const detectWebhookFormat = (url?: string): NotificationFormValues['webhook_format'] | null => {
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

export const resolveWebhookFormat = (
  format: NotificationFormValues['webhook_format'] | undefined,
  url?: string,
): NonNullable<NotificationFormValues['webhook_format']> => {
  const detected = detectWebhookFormat(url);
  if (detected) return detected;
  if (format && format !== 'generic') return format;
  return 'feishu';
};

export const notificationFormFields = (data: NotificationSnapshot): NotificationFormValues => {
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

export const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};
