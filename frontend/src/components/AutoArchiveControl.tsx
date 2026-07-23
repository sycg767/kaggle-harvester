import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Collapse,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
  type TableColumnsType,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Gauge } from 'lucide-react';
import { Bell, Mail, Send, Webhook } from 'lucide-react';
import {
  api,
  type AutoArchiveCheckedItem,
  type AutoArchiveConfig,
  type AutoArchiveRunDetail,
  type AutoArchiveRunLog,
  type AutoArchiveSnapshot,
  type NotificationConfigUpdate,
  type NotificationSnapshot,
} from '../api';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../kaggleUrls';
import DialogTitle from './DialogTitle';

const { Text } = Typography;

interface AutoArchiveControlProps {
  currentCompetition: string;
  onArchiveComplete: () => void;
}

interface SummaryItemProps {
  label: string;
  children: React.ReactNode;
  tabular?: boolean;
}

interface NotificationFormValues extends Omit<NotificationConfigUpdate, 'smtp_to'> {
  smtp_to_text?: string;
  email_provider?: EmailProvider;
}

type EmailProvider = 'qq' | '163' | 'gmail' | 'outlook' | 'custom';

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

const notificationFormFields = (data: NotificationSnapshot): NotificationFormValues => {
  const provider = detectEmailProvider(data.config.smtp_host);
  const preset = provider === 'custom' ? null : EMAIL_PRESETS[provider];
  return {
    ...data.config,
    webhook_format: !data.config.webhook_configured && data.config.webhook_format === 'generic'
      ? 'feishu'
      : data.config.webhook_format,
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

const SummaryItem: React.FC<SummaryItemProps> = ({ label, children, tabular = false }) => (
  <div className="auto-archive-summary-item">
    <span className="auto-archive-summary-label">{label}</span>
    <div className={`auto-archive-summary-value${tabular ? ' is-tabular' : ''}`}>{children}</div>
  </div>
);

const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

const formatDuration = (seconds: number) => {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
};

const renderRunOutcome = (log: AutoArchiveRunLog) => {
  if (log.outcome === 'success') {
    return <Tag color="success" icon={<CheckCircleOutlined />}>成功</Tag>;
  }
  if (log.outcome === 'partial') {
    return (
      <Tooltip title={log.error || '部分 Kernel 处理失败'}>
        <Tag color="warning" icon={<ExclamationCircleOutlined />}>部分失败</Tag>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={log.error || '检查失败'}>
      <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>
    </Tooltip>
  );
};

const renderCheckedAction = (item: AutoArchiveCheckedItem) => {
  if (item.action === 'archived') {
    return <Tag color="success" icon={<CheckCircleOutlined />}>已归档</Tag>;
  }
  if (item.action === 'skipped') return <Tag color="blue">已处理</Tag>;
  if (item.action === 'failed') {
    return (
      <Tooltip title={item.error || '归档失败'}>
        <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>
      </Tooltip>
    );
  }
  return <Tag>未命中</Tag>;
};

const detailColumns: TableColumnsType<AutoArchiveCheckedItem> = [
  {
    title: '分数',
    dataIndex: 'public_score',
    width: 92,
    sorter: (a, b) => (a.public_score ?? Number.POSITIVE_INFINITY) - (b.public_score ?? Number.POSITIVE_INFINITY),
    render: (value?: number) => value === undefined || value === null ? '—' : <Text strong>{value.toFixed(4)}</Text>,
  },
  {
    title: 'Kernel',
    key: 'kernel',
    width: 300,
    render: (_, item) => (
      <div style={{ minWidth: 0 }}>
        <a href={kaggleKernelUrl(item.ref)} target="_blank" rel="noreferrer" className="kernel-title">
          {item.title || item.ref}
        </a>
        <Text type="secondary" className="kernel-ref">{item.ref}</Text>
      </div>
    ),
  },
  {
    title: '作者',
    dataIndex: 'author',
    width: 135,
    ellipsis: true,
    render: (value: string, item) => {
      const owner = kaggleOwnerFromRef(item.ref);
      return <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer">{value || owner}</a>;
    },
  },
  {
    title: '最后运行',
    dataIndex: 'last_run_time',
    width: 170,
    render: formatDate,
  },
  {
    title: '处理结果',
    key: 'action',
    width: 110,
    render: (_, item) => renderCheckedAction(item),
  },
  {
    title: '版本',
    dataIndex: 'version_number',
    width: 75,
    render: (value?: number) => value ? `v${value}` : '—',
  },
];

const AutoArchiveControl: React.FC<AutoArchiveControlProps> = ({
  currentCompetition,
  onArchiveComplete,
}) => {
  const [form] = Form.useForm<AutoArchiveConfig>();
  const [notificationForm] = Form.useForm<NotificationFormValues>();
  const [snapshot, setSnapshot] = useState<AutoArchiveSnapshot | null>(null);
  const [notificationSnapshot, setNotificationSnapshot] = useState<NotificationSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testingNotification, setTestingNotification] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<AutoArchiveRunLog | null>(null);
  const [runDetail, setRunDetail] = useState<AutoArchiveRunDetail | null>(null);
  const [detailSearch, setDetailSearch] = useState('');
  const [detailAction, setDetailAction] = useState('all');
  const [narrowViewport, setNarrowViewport] = useState(
    () => window.matchMedia('(max-width: 768px)').matches,
  );
  const latestLogIdRef = useRef<string | null>(null);
  const onArchiveCompleteRef = useRef(onArchiveComplete);

  useEffect(() => {
    onArchiveCompleteRef.current = onArchiveComplete;
  }, [onArchiveComplete]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 768px)');
    const update = () => setNarrowViewport(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const loadStatus = useCallback(async (fillForm = false) => {
    try {
      const data = await api.getAutoArchive();
      setSnapshot(data);
      setLoadError(null);
      const latestLog = data.logs[0];
      if (latestLogIdRef.current === null) {
        latestLogIdRef.current = latestLog?.id || '';
      } else if (latestLog && latestLog.id !== latestLogIdRef.current) {
        latestLogIdRef.current = latestLog.id;
        if (latestLog.archived_count > 0) onArchiveCompleteRef.current();
      }
      if (fillForm) {
        form.setFieldsValue({
          ...data.config,
          competition: data.config.enabled
            ? data.config.competition
            : currentCompetition,
        });
      }
      return data;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '自动归档状态读取失败。');
      return null;
    }
  }, [currentCompetition, form]);

  const loadNotifications = useCallback(async (fillForm = false) => {
    try {
      const data = await api.getNotifications();
      setNotificationSnapshot(data);
      if (fillForm) {
        notificationForm.setFieldsValue(notificationFormFields(data));
      }
      return data;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '通知配置读取失败。');
      return null;
    }
  }, [notificationForm]);

  useEffect(() => {
    void loadStatus(false);
    const timer = window.setInterval(
      () => void loadStatus(false),
      open ? 5_000 : 30_000,
    );
    return () => window.clearInterval(timer);
  }, [loadStatus, open]);

  const showSettings = async () => {
    setOpen(true);
    setLoading(true);
    await Promise.all([loadStatus(true), loadNotifications(true)]);
    setLoading(false);
  };

  const buildNotificationPayload = (values: NotificationFormValues): NotificationConfigUpdate => {
    // 表单未挂载/未赋值字段不要覆盖服务端现值（改阈值时最容易踩中）。
    const base = notificationSnapshot?.config;
    const smtpFrom = values.smtp_from ?? base?.smtp_from ?? '';
    const smtpUsernameRaw = values.smtp_username ?? base?.smtp_username ?? '';
    const smtpToText = values.smtp_to_text;
    const smtpTo = smtpToText !== undefined
      ? smtpToText.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean)
      : base?.smtp_to;
    return {
      notify_on_archive: values.notify_on_archive ?? base?.notify_on_archive,
      notify_on_failure: values.notify_on_failure ?? base?.notify_on_failure,
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
    const values = await form.validateFields();
    // 通知区可能有条件字段未挂载；先校验已挂载项，再与全部字段合并。
    const notificationValues = {
      ...notificationForm.getFieldsValue(true),
      ...(await notificationForm.validateFields()),
    } as NotificationFormValues;
    setSaving(true);
    try {
      const notifications = await api.updateNotifications(
        buildNotificationPayload(notificationValues),
      );
      const data = await api.updateAutoArchive(values);
      setSnapshot(data);
      setNotificationSnapshot(notifications);
      form.setFieldsValue(data.config);
      notificationForm.setFieldsValue(notificationFormFields(notifications));
      message.success(values.enabled ? '自动归档已启用' : '自动归档配置已保存');
      return data;
    } finally {
      setSaving(false);
    }
  };

  const testNotification = async () => {
    let values: NotificationFormValues;
    try {
      values = await notificationForm.validateFields();
    } catch {
      return;
    }
    setTestingNotification(true);
    try {
      const saved = await api.updateNotifications(buildNotificationPayload(values));
      setNotificationSnapshot(saved);
      const result = await api.testNotifications();
      if (result.success) {
        message.success('测试通知已发送');
      } else {
        message.error(result.channels.filter((item) => !item.success).map((item) => `${item.channel}：${item.message}`).join('；'));
      }
      await loadNotifications(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试通知发送失败。');
    } finally {
      setTestingNotification(false);
    }
  };

  const runNow = async () => {
    let values: AutoArchiveConfig;
    let notificationValues: NotificationFormValues;
    try {
      values = await form.validateFields();
      notificationValues = {
        ...notificationForm.getFieldsValue(true),
        ...(await notificationForm.validateFields()),
      } as NotificationFormValues;
    } catch {
      return;
    }
    setRunning(true);
    try {
      await api.updateNotifications(buildNotificationPayload(notificationValues));
      await api.updateAutoArchive(values);
      const data = await api.runAutoArchive();
      setSnapshot(data);
      latestLogIdRef.current = data.logs[0]?.id || latestLogIdRef.current;
      form.setFieldsValue(data.config);
      if (data.status.archived_count > 0) onArchiveComplete();
      message.success(
        `检查完成：新增 ${data.status.archived_count}，跳过 ${data.status.skipped_count}`,
      );
      await loadNotifications(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '立即检查失败。');
      await loadStatus(false);
    } finally {
      setRunning(false);
    }
  };

  const showRunDetail = async (log: AutoArchiveRunLog) => {
    setSelectedLog(log);
    setRunDetail(null);
    setDetailError(null);
    setDetailSearch('');
    setDetailAction('all');
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const detail = await api.getAutoArchiveLog(log.id);
      setRunDetail(detail);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '运行明细读取失败。');
    } finally {
      setDetailLoading(false);
    }
  };

  const detailItems = useMemo(() => {
    const query = detailSearch.trim().toLowerCase();
    return (runDetail?.items || []).filter((item) => {
      if (detailAction !== 'all' && item.action !== detailAction) return false;
      if (!query) return true;
      return [item.ref, item.title, item.author]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [detailAction, detailSearch, runDetail?.items]);

  const status = snapshot?.status;
  const enabled = snapshot?.config.enabled ?? false;
  const webhookEnabled = Form.useWatch('webhook_enabled', notificationForm) ?? false;
  const emailEnabled = Form.useWatch('email_enabled', notificationForm) ?? false;
  const webhookFormat = Form.useWatch('webhook_format', notificationForm) ?? 'generic';
  const emailProvider = Form.useWatch('email_provider', notificationForm) ?? 'qq';
  const webhookHelp = WEBHOOK_HELP[webhookFormat];
  const emailPreset = emailProvider === 'custom' ? null : EMAIL_PRESETS[emailProvider];

  const applyEmailProvider = (provider: EmailProvider) => {
    if (provider === 'custom') return;
    const preset = EMAIL_PRESETS[provider];
    notificationForm.setFieldsValue({
      smtp_host: preset.host,
      smtp_port: preset.port,
      smtp_security: preset.security,
      smtp_username: notificationForm.getFieldValue('smtp_from')?.trim() || '',
    });
  };
  const directionLabel = status?.effective_score_direction === 'maximize'
    ? '高于阈值时归档'
    : status?.effective_score_direction === 'minimize'
      ? '低于阈值时归档'
      : '首次检查时自动识别分数方向';

  return (
    <>
      <Space size={4} className="auto-archive-trigger">
        {enabled && <Tag color="success">已启用</Tag>}
        <Button icon={<ClockCircleOutlined />} aria-label="自动归档" onClick={showSettings}>
          自动归档
        </Button>
      </Space>

      <Modal
        className="newapi-dialog auto-archive-modal"
        title={(
          <DialogTitle disabled={running} onClose={() => !running && setOpen(false)}>
            <Space><ClockCircleOutlined />自动归档设置</Space>
          </DialogTitle>
        )}
        open={open}
        forceRender
        destroyOnClose={false}
        closable={false}
        width={900}
        confirmLoading={saving}
        styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowX: 'hidden', overflowY: 'auto' } }}
        onCancel={() => !running && setOpen(false)}
        maskClosable={!running}
        footer={[
          <Button key="close" disabled={running} onClick={() => setOpen(false)}>关闭</Button>,
          <Button
            key="run"
            icon={<ReloadOutlined />}
            loading={running}
            disabled={saving}
            onClick={runNow}
          >
            立即检查
          </Button>,
          <Button
            key="save"
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={running}
            onClick={() => void saveConfig().catch((error) => {
              message.error(error instanceof Error ? error.message : '配置保存失败。');
            })}
          >
            保存配置
          </Button>,
        ]}
      >
        {loadError && (
          <Alert
            type="error"
            showIcon
            message="状态读取失败"
            description={loadError}
            style={{ marginBottom: 16 }}
          />
        )}

        <Alert
          className="auto-archive-note"
          type="info"
          showIcon
          icon={<Gauge size={16} strokeWidth={1.9} />}
          message={`每次检查公开分数榜前 50 条；${directionLabel}。运行时间未变化时复用缓存，新版本出现后才检查历史并归档。`}
          style={{ marginBottom: 16 }}
        />

        <div
          className={`auto-archive-scheduler-status${status?.scheduler_alive ? ' is-online' : ' is-offline'}`}
          role="status"
          aria-live="polite"
        >
          <span className="auto-archive-scheduler-icon" aria-hidden="true">
            {status?.scheduler_alive ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
          </span>
          <div className="auto-archive-scheduler-copy">
            <span className="auto-archive-scheduler-title">本地调度器</span>
            <span className="auto-archive-scheduler-detail">
              {status?.scheduler_alive ? '在线' : '未运行'}
            </span>
          </div>
        </div>

        <Form<AutoArchiveConfig>
          form={form}
          layout="vertical"
          disabled={loading || running}
          initialValues={{
            enabled: false,
            competition: currentCompetition,
            interval_minutes: 30,
            include_outputs: true,
            score_direction: 'auto',
          }}
        >
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="competition" label="监控竞赛" rules={[
                { required: true, message: '请输入竞赛标识' },
                { pattern: /^[a-z0-9][a-z0-9-]{2,119}$/i, message: '竞赛标识格式无效' },
              ]}>
                <Input aria-label="监控竞赛标识" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item
                name="score_threshold"
                label="分数阈值"
                tooltip="根据竞赛评分方向自动判断高于或低于阈值的版本"
                rules={[
                  { required: true, message: '请设置分数阈值' },
                ]}
              >
                <InputNumber aria-label="自动归档分数阈值" precision={6} style={{ width: '100%' }} placeholder="例如 7.0" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item name="interval_minutes" label="刷新间隔" rules={[{ required: true }]}>
                <Select aria-label="自动归档刷新间隔" options={[
                  { value: 1, label: '1 分钟' },
                  { value: 2, label: '2 分钟' },
                  { value: 5, label: '5 分钟' },
                  { value: 10, label: '10 分钟' },
                  { value: 30, label: '30 分钟' },
                  { value: 60, label: '1 小时' },
                  { value: 180, label: '3 小时' },
                  { value: 360, label: '6 小时' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Space size="large" wrap>
            <Form.Item name="enabled" valuePropName="checked" label="定时任务" style={{ marginBottom: 16 }}>
              <Switch checkedChildren="已启用" unCheckedChildren="已关闭" />
            </Form.Item>
            <Form.Item name="include_outputs" valuePropName="checked" label="归档内容" style={{ marginBottom: 16 }}>
              <Switch checkedChildren="包含输出" unCheckedChildren="仅源码" />
            </Form.Item>
          </Space>
        </Form>

        <Collapse
          className="notification-settings"
          bordered={false}
          items={[{
            key: 'notifications',
            label: (
              <div className="notification-settings-label">
                <Bell size={16} strokeWidth={1.9} aria-hidden="true" />
                <span>通知设置</span>
                <Tag color={notificationSnapshot?.config.webhook_enabled || notificationSnapshot?.config.email_enabled ? 'success' : undefined}>
                  {notificationSnapshot?.config.webhook_enabled || notificationSnapshot?.config.email_enabled ? '已启用' : '未启用'}
                </Tag>
              </div>
            ),
            children: (
              <Form<NotificationFormValues>
                form={notificationForm}
                layout="vertical"
                disabled={loading || running || saving}
                initialValues={{
                  notify_on_archive: true,
                  notify_on_failure: true,
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
                <Alert
                  className="notification-choice-hint"
                  type="info"
                  showIcon
                  message="怎么选"
                  description="有飞书、钉钉或企业微信群，就选 Webhook；没有群机器人，就选 SMTP 邮件。QQ/163 邮箱通常最容易配置。"
                />
                <div className="notification-event-row">
                  <Form.Item name="notify_on_archive" valuePropName="checked" label="新增归档" style={{ marginBottom: 12 }}>
                    <Switch checkedChildren="通知" unCheckedChildren="静默" />
                  </Form.Item>
                  <Form.Item name="notify_on_failure" valuePropName="checked" label="检查失败" style={{ marginBottom: 12 }}>
                    <Switch checkedChildren="通知" unCheckedChildren="静默" />
                  </Form.Item>
                  <Text type="secondary">普通检查无新增且无失败时不发送</Text>
                </div>

                <div className="notification-channel-section">
                  <div className="notification-channel-heading">
                    <Webhook size={16} strokeWidth={1.9} aria-hidden="true" />
                    <Text strong>Webhook</Text>
                    <Form.Item name="webhook_enabled" valuePropName="checked" noStyle>
                      <Switch aria-label="启用 Webhook 通知" />
                    </Form.Item>
                    {notificationSnapshot?.config.webhook_configured && <Tag color="success">凭据已保存</Tag>}
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
                            extra={notificationSnapshot?.config.webhook_configured ? '地址已经安全保存；不修改时保持为空即可' : '完整粘贴，不要删除地址中的 key、token 或 access_token'}
                            rules={[{
                              validator: (_, value) => (
                                value?.trim() || notificationSnapshot?.config.webhook_configured
                                  ? Promise.resolve()
                                  : Promise.reject(new Error('请粘贴机器人提供的 Webhook 地址'))
                              ),
                            }]}
                          >
                            <Input.Password aria-label="Webhook 地址" autoComplete="off" placeholder={notificationSnapshot?.config.webhook_configured ? '已安全保存；留空表示不修改' : webhookHelp.placeholder} />
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
                    {notificationSnapshot?.config.smtp_password_configured && <Tag color="success">密码已保存</Tag>}
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
                          <Form.Item name="smtp_from" label="发件邮箱" rules={[{ required: true, type: 'email', message: '请输入有效发件邮箱' }]} extra="用这个邮箱发送通知">
                            <Input
                              aria-label="通知发件邮箱"
                              placeholder={emailProvider === 'qq' ? '123456@qq.com' : emailProvider === '163' ? 'name@163.com' : 'name@example.com'}
                              onBlur={(event) => {
                                if (emailProvider !== 'custom' || !notificationForm.getFieldValue('smtp_username')) {
                                  notificationForm.setFieldValue('smtp_username', event.target.value.trim());
                                }
                              }}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name="smtp_to_text" label="收件人邮箱" rules={[{ required: true, message: '请输入至少一个收件人' }]} extra="可以与发件邮箱相同；多个地址用逗号分隔">
                            <Input.TextArea aria-label="通知收件人" autoSize={{ minRows: 1, maxRows: 3 }} placeholder="receiver@example.com" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={12}>
                        <Col xs={24}>
                          <Form.Item
                            name="smtp_password"
                            label={emailPreset?.passwordLabel || 'SMTP 授权码或应用密码'}
                            extra={notificationSnapshot?.config.smtp_password_configured ? '授权码已经安全保存；不修改时保持为空即可' : '不要填写邮箱网页登录密码；到邮箱安全设置中生成授权码或应用密码'}
                            rules={[{
                              validator: (_, value) => (
                                value || notificationSnapshot?.config.smtp_password_configured
                                  ? Promise.resolve()
                                  : Promise.reject(new Error('请填写邮箱生成的授权码或应用密码'))
                              ),
                            }]}
                          >
                            <Input.Password aria-label="邮箱授权码" autoComplete="new-password" placeholder={notificationSnapshot?.config.smtp_password_configured ? '已安全保存；留空表示不修改' : '粘贴邮箱生成的授权码'} />
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
                    <Tag>{notificationSnapshot?.config.secret_storage === 'windows_dpapi' ? 'Windows 加密存储' : notificationSnapshot?.config.secret_storage === 'environment' ? '环境变量' : '仅当前会话'}</Tag>
                    {notificationSnapshot?.status.last_sent_at && <Text type="secondary">最近发送 {formatDate(notificationSnapshot.status.last_sent_at)}</Text>}
                    {notificationSnapshot?.status.pending_count ? <Text type="warning">待重试 {notificationSnapshot.status.pending_count}</Text> : null}
                  </Space>
                  <Button
                    icon={<Send size={15} strokeWidth={1.9} />}
                    loading={testingNotification}
                    disabled={!webhookEnabled && !emailEnabled}
                    onClick={() => void testNotification()}
                  >
                    发送测试通知
                  </Button>
                </div>
                {notificationSnapshot?.status.last_error && (
                  <Alert type="error" showIcon message="最近一次通知发送失败" description={notificationSnapshot.status.last_error} />
                )}
              </Form>
            ),
          }]}
        />

        <div className="auto-archive-summary-grid" role="group" aria-label="自动归档运行状态">
          <SummaryItem label="任务状态">
            {!status?.scheduler_alive
              ? <Tag color="error">调度器离线</Tag>
              : status?.running
              ? <Tag color="processing">正在检查</Tag>
              : enabled
                ? <Tag color="success">等待下次检查</Tag>
                : <Tag>已关闭</Tag>}
          </SummaryItem>
          <SummaryItem label="最近检查" tabular>{formatDate(status?.last_checked_at)}</SummaryItem>
          <SummaryItem label="下次检查" tabular>{formatDate(status?.next_run_at)}</SummaryItem>
          <SummaryItem label="调度心跳" tabular>{formatDate(status?.scheduler_heartbeat_at)}</SummaryItem>
          <SummaryItem label="服务启动" tabular>{formatDate(status?.service_started_at)}</SummaryItem>
          <SummaryItem label="最近结果">
            {status
              ? `${status.checked_count} 个已检查，${status.matched_count} 个命中`
              : '—'}
          </SummaryItem>
          <SummaryItem label="本地新增" tabular>{status?.archived_count ?? 0}</SummaryItem>
          <SummaryItem label="已存在 / 失败" tabular>
            {status ? `${status.skipped_count} / ${status.failed_count}` : '0 / 0'}
          </SummaryItem>
        </div>

        {status?.last_error && (
          <Alert
            type="error"
            showIcon
            message="最近一次检查有错误"
            description={status.last_error}
            style={{ marginTop: 16 }}
          />
        )}

        <div className="dialog-section-heading">
          <HistoryOutlined />
          <Text strong>运行记录</Text>
          <Text type="secondary" className="dialog-section-hint">弹窗打开时每 5 秒更新</Text>
        </div>
        <List<AutoArchiveRunLog>
          className="auto-archive-log-list"
          size="small"
          dataSource={snapshot?.logs || []}
          pagination={{ pageSize: 5, hideOnSinglePage: true }}
          locale={{ emptyText: <Text type="secondary">定时任务尚未完成过检查</Text> }}
          renderItem={(log) => (
            <List.Item
              className="auto-archive-log-row"
              role="button"
              tabIndex={0}
              aria-label={`查看 ${formatDate(log.finished_at)} 的检查详情`}
              actions={[
                <Tooltip title="查看本次检查的 Kernel 明细" key="detail">
                  <Button
                    type="text"
                    icon={<RightOutlined />}
                    aria-label={`打开 ${formatDate(log.finished_at)} 的检查详情`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void showRunDetail(log);
                    }}
                  />
                </Tooltip>,
              ]}
              onClick={() => void showRunDetail(log)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void showRunDetail(log);
                }
              }}
            >
              <List.Item.Meta
                title={(
                  <Space size={6} wrap>
                    <Text strong>{formatDate(log.finished_at)}</Text>
                    <Tag icon={log.trigger === 'scheduled' ? <ClockCircleOutlined /> : undefined}>
                      {log.trigger === 'scheduled' ? '定时' : '手动'}
                    </Tag>
                    {renderRunOutcome(log)}
                  </Space>
                )}
                description={(
                  <Space size={12} wrap className="auto-archive-log-summary">
                    <span>检查 <Text strong>{log.checked_count}</Text></span>
                    <span>命中 <Text strong>{log.matched_count}</Text></span>
                    <span>新增 <Text type={log.archived_count > 0 ? 'success' : undefined} strong>{log.archived_count}</Text></span>
                    <span>跳过 <Text>{log.skipped_count}</Text></span>
                    {log.failed_count > 0 && <span>失败 <Text type="danger" strong>{log.failed_count}</Text></span>}
                    <Text type="secondary">耗时 {formatDuration(log.duration_seconds)}</Text>
                    {!log.details_available && <Text type="secondary">仅汇总</Text>}
                  </Space>
                )}
              />
            </List.Item>
          )}
        />
      </Modal>

      <Drawer
        className="newapi-detail-drawer"
        title={(
          <DialogTitle onClose={() => setDetailOpen(false)}>
            <Space size={8} wrap>
              <HistoryOutlined />
              <span>检查详情</span>
              <Text type="secondary">{formatDate(selectedLog?.finished_at)}</Text>
            </Space>
          </DialogTitle>
        )}
        closable={false}
        extra={selectedLog ? renderRunOutcome(selectedLog) : null}
        open={detailOpen}
        width={narrowViewport ? '100%' : 980}
        zIndex={1100}
        onClose={() => setDetailOpen(false)}
      >
        {detailLoading ? (
          <div style={{ padding: 64, textAlign: 'center' }}><Spin /></div>
        ) : detailError ? (
          <Alert type="error" showIcon message="运行明细读取失败" description={detailError} />
        ) : runDetail && selectedLog ? (
          <>
            <div className="auto-archive-summary-grid" role="group" aria-label="本次检查汇总">
              <SummaryItem label="触发方式">
                {selectedLog.trigger === 'scheduled' ? '定时检查' : '手动检查'}
              </SummaryItem>
              <SummaryItem label="完成时间" tabular>{formatDate(selectedLog.finished_at)}</SummaryItem>
              <SummaryItem label="耗时" tabular>{formatDuration(selectedLog.duration_seconds)}</SummaryItem>
              <SummaryItem label="检查 / 命中" tabular>
                {selectedLog.checked_count} / {selectedLog.matched_count}
              </SummaryItem>
              <SummaryItem label="新增 / 跳过" tabular>
                {selectedLog.archived_count} / {selectedLog.skipped_count}
              </SummaryItem>
              <SummaryItem label="失败" tabular>{selectedLog.failed_count}</SummaryItem>
            </div>

            {!runDetail.log.details_available && (
              <Alert
                type="info"
                showIcon
                message="该记录创建于详细日志启用前，仅保留汇总数据。"
                style={{ marginTop: 16 }}
              />
            )}

            {runDetail.log.details_available && (
              <>
                <Row gutter={[12, 12]} style={{ marginTop: 16, marginBottom: 12 }}>
                  <Col xs={24} sm={16}>
                    <Input
                      aria-label="筛选检查明细"
                      allowClear
                      prefix={<SearchOutlined />}
                      value={detailSearch}
                      placeholder="筛选 Kernel、作者或 ref"
                      onChange={(event) => setDetailSearch(event.target.value)}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Select
                      aria-label="检查明细处理结果筛选"
                      value={detailAction}
                      style={{ width: '100%' }}
                      onChange={setDetailAction}
                      options={[
                        { value: 'all', label: '全部处理结果' },
                        { value: 'not_matched', label: '未命中阈值' },
                        { value: 'archived', label: '新增归档' },
                        { value: 'skipped', label: '已处理 / 跳过' },
                        { value: 'failed', label: '处理失败' },
                      ]}
                    />
                  </Col>
                </Row>
                <div className="desktop-data-table">
                  <Table<AutoArchiveCheckedItem>
                    size="small"
                    rowKey="ref"
                    columns={detailColumns}
                    dataSource={detailItems}
                    pagination={{
                      defaultPageSize: 10,
                      pageSizeOptions: [10, 25, 50],
                      showSizeChanger: true,
                      showTotal: (total) => `显示 ${total} / ${runDetail.items.length} 个 Kernel`,
                    }}
                    scroll={{ x: 900 }}
                  />
                </div>
                <div className="mobile-data-list auto-archive-detail-list">
                  {!detailItems.length && <Empty description="没有符合条件的 Kernel" />}
                  {detailItems.map((item) => {
                    const owner = kaggleOwnerFromRef(item.ref);
                    return (
                      <article className="mobile-data-card" key={item.ref}>
                        <div className="mobile-data-card-head">
                          <div className="mobile-data-card-title">
                            <a className="kernel-title" href={kaggleKernelUrl(item.ref)} target="_blank" rel="noreferrer">
                              {item.title || item.ref}
                            </a>
                            <span className="kernel-ref">{item.ref}</span>
                          </div>
                          <span className="score-value">
                            {item.public_score === undefined || item.public_score === null ? '—' : item.public_score.toFixed(4)}
                          </span>
                        </div>
                        <div className="mobile-data-card-meta">
                          <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer">@{item.author || owner}</a>
                          <span>{formatDate(item.last_run_time)}</span>
                          {item.version_number && <span>v{item.version_number}</span>}
                          {renderCheckedAction(item)}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : null}
      </Drawer>
    </>
  );
};

export default AutoArchiveControl;
