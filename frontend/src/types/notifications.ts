export type WebhookFormat = 'generic' | 'slack' | 'feishu' | 'dingtalk' | 'wecom' | 'ntfy';
export type SmtpSecurity = 'starttls' | 'ssl' | 'none';

export interface NotificationConfig {
  notify_on_archive: boolean;
  notify_on_failure: boolean;
  notify_on_score: boolean;
  notify_on_simulation?: boolean;
  wechat_enabled?: boolean;
  webhook_enabled: boolean;
  webhook_format: WebhookFormat;
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_security: SmtpSecurity;
  smtp_username: string;
  smtp_from: string;
  smtp_to: string[];
  webhook_configured: boolean;
  smtp_password_configured: boolean;
  secret_storage: 'windows_dpapi' | 'environment' | 'file' | 'session';
}

export interface NotificationConfigUpdate {
  notify_on_archive?: boolean;
  notify_on_failure?: boolean;
  notify_on_score?: boolean;
  notify_on_simulation?: boolean;
  wechat_enabled?: boolean;
  webhook_enabled?: boolean;
  webhook_format?: WebhookFormat;
  email_enabled?: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_security?: SmtpSecurity;
  smtp_username?: string;
  smtp_from?: string;
  smtp_to?: string[];
  webhook_url?: string;
  smtp_password?: string;
  clear_webhook_url?: boolean;
  clear_smtp_password?: boolean;
}

export interface NotificationStatus {
  worker_alive: boolean;
  last_sent_at?: string;
  last_error?: string;
  last_event_id?: string;
  pending_count: number;
}

export interface NotificationSnapshot {
  config: NotificationConfig;
  status: NotificationStatus;
  deliveries?: Array<{
    id: string; event_id: string; event: string; competition: string; channel: string;
    state: 'queued' | 'sent' | 'failed'; attempts: number; recorded_at: string; error?: string | null;
  }>;
}

export interface NotificationChannelResult {
  channel: string;
  success: boolean;
  message: string;
}

export interface NotificationTestResult {
  success: boolean;
  channels: NotificationChannelResult[];
}
