import type React from 'react';
import type { HealthStatus } from '../../api';

export interface NavItem {
  key: 'dashboard' | 'arena' | 'kernels' | 'archives';
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export const formatDate = (value?: string): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

export const formatBytes = (value = 0): string => {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
};

export const redactDiagnostic = (value: string): string =>
  value
    .replace(/https?:\/\/\S+/gi, '[URL 已隐藏]')
    .replace(/(token|password|secret|key)\s*[=:]\s*\S+/gi, '$1=[已隐藏]');

export const copyDiagnostics = async (health: HealthStatus | null): Promise<void> => {
  const report = health
    ? {
        service: health.service,
        version: health.version,
        ready: health.ready,
        kaggle_cli: health.kaggle_cli,
        utf8_wrapper_exists: health.utf8_wrapper_exists,
        token_configured: health.token_configured,
        auto_archive: {
          running: health.auto_archive.running,
          scheduler_alive: health.auto_archive.scheduler_alive,
          last_error: health.auto_archive.last_error
            ? redactDiagnostic(health.auto_archive.last_error)
            : null,
        },
        submission_monitor: health.submission_monitor
          ? {
              running: health.submission_monitor.running,
              scheduler_alive: health.submission_monitor.scheduler_alive,
              last_error: health.submission_monitor.last_error
                ? redactDiagnostic(health.submission_monitor.last_error)
                : null,
            }
          : null,
        notifications: health.notifications
          ? {
              worker_alive: health.notifications.worker_alive,
              pending_count: health.notifications.pending_count,
              last_error: health.notifications.last_error
                ? redactDiagnostic(health.notifications.last_error)
                : null,
            }
          : null,
        archive: health.archive,
      }
    : { service: 'unavailable' };
  await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
};
