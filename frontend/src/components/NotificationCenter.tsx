import React, { useCallback, useEffect, useState } from 'react';
import {
  App as AntApp,
  Badge,
  Button,
  Form,
  Modal,
  Space,
  Tabs,
  Tag,
} from 'antd';
import {
  Bell,
  Eye,
  History,
  Send,
  ShieldCheck,
  Webhook,
  Zap,
} from 'lucide-react';
import {
  api,
  type NotificationConfigUpdate,
  type NotificationSnapshot,
} from '../api';
import DialogTitle from './DialogTitle';
import {
  ChannelConfigTab,
  DeliveryStatusTab,
  EventSubscriptionTab,
  MessagePreviewTab,
  type NotificationFormValues,
  notificationFormFields,
} from './notifications';

interface NotificationCenterProps {
  buttonText?: string;
  buttonIcon?: React.ReactNode;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  buttonText,
  buttonIcon,
}) => {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<NotificationFormValues>();
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('channels');
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
      notify_on_simulation: values.notify_on_simulation ?? base?.notify_on_simulation,
      wechat_enabled: values.wechat_enabled ?? base?.wechat_enabled,
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

  const wechatEnabled = Form.useWatch('wechat_enabled', form) ?? true;
  const webhookEnabled = Form.useWatch('webhook_enabled', form) ?? false;
  const emailEnabled = Form.useWatch('email_enabled', form) ?? false;

  const activeChannelsCount = (snapshot?.config.wechat_enabled ? 1 : 0) + (snapshot?.config.webhook_enabled ? 1 : 0) + (snapshot?.config.email_enabled ? 1 : 0);

  return (
    <>
      <Button
        size={buttonText ? 'small' : undefined}
        className="notification-center-trigger"
        icon={buttonIcon || <Bell size={15} strokeWidth={1.9} />}
        aria-label={buttonText || '通知中心'}
        onClick={() => void showSettings()}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}
      >
        <span>{buttonText || '通知中心'}</span>
        {activeChannelsCount > 0 && !buttonText && (
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
                disabled={!wechatEnabled && !webhookEnabled && !emailEnabled}
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
        <Form<NotificationFormValues>
          form={form}
          layout="vertical"
          disabled={loading || saving || testing}
          initialValues={{
            notify_on_archive: true,
            notify_on_failure: true,
            notify_on_score: true,
            notify_on_simulation: true,
            wechat_enabled: true,
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
                    {(wechatEnabled || webhookEnabled || emailEnabled) && <Tag color="green" style={{ margin: 0, padding: '0 4px', fontSize: 10 }}>已启用</Tag>}
                  </Space>
                ),
                children: (
                  <ChannelConfigTab
                    form={form}
                    snapshot={snapshot}
                    wechatEnabled={wechatEnabled}
                    webhookEnabled={webhookEnabled}
                    emailEnabled={emailEnabled}
                  />
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
                children: <EventSubscriptionTab />,
              },
              {
                key: 'preview',
                label: (
                  <Space size={6}>
                    <Eye size={15} />
                    <span>推送消息样式预览</span>
                  </Space>
                ),
                children: <MessagePreviewTab />,
              },
              {
                key: 'status',
                label: (
                  <Space size={6}>
                    <History size={15} />
                    <span>投递状态与记录</span>
                  </Space>
                ),
                children: <DeliveryStatusTab snapshot={snapshot} />,
              },
            ]}
          />
        </Form>
      </Modal>
    </>
  );
};

export default NotificationCenter;
