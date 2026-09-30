import React from 'react';
import { App, Button, Drawer } from 'antd';
import {
  Activity,
  AlertCircle,
  Bell,
  CheckCircle2,
  Copy,
  HardDrive,
  KeyRound,
  LogOut,
  Radio,
  Server,
  Terminal,
  XCircle,
} from 'lucide-react';
import { apiAuth, type HealthStatus } from '../../api';
import DialogTitle from '../DialogTitle';
import { copyDiagnostics, formatBytes } from './layoutUtils';

interface RuntimeDiagnosticsDrawerProps {
  open: boolean;
  health: HealthStatus | null;
  onClose: () => void;
  onForgetApiKey: () => void;
}

export const RuntimeDiagnosticsDrawer: React.FC<RuntimeDiagnosticsDrawerProps> = ({
  open,
  health,
  onClose,
  onForgetApiKey,
}) => {
  const { message } = App.useApp();

  const errors: { source: string; error: string }[] = [];
  if (health?.auto_archive?.last_error) {
    errors.push({ source: '自动归档', error: health.auto_archive.last_error });
  }
  if (health?.submission_monitor?.last_error) {
    errors.push({ source: '提交监控', error: health.submission_monitor.last_error });
  }
  if (health?.simulation_monitor?.last_error) {
    errors.push({ source: '天梯对抗', error: health.simulation_monitor.last_error });
  }

  return (
    <Drawer
      className="app-drawer diagnostics-drawer"
      title={(
        <DialogTitle
          icon={<Activity size={18} color="#007aff" />}
          title="运行概况与系统诊断"
          subtitle={health?.service ? `${health.service} · v${health.version}` : 'System Inspector'}
          onClose={onClose}
        />
      )}
      placement="right"
      open={open}
      onClose={onClose}
      closable={false}
      width={480}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <Button
            icon={<Copy size={14} />}
            onClick={() => {
              void copyDiagnostics(health);
              message.success('已复制完整诊断报告到剪贴板');
            }}
          >
            复制诊断报告
          </Button>
          <Button type="primary" onClick={onClose}>
            完成
          </Button>
        </div>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 1. Backend 核心状态 */}
        <div className="settings-group">
          <div className="settings-group-header">
            <Server size={14} />
            <span>Backend 服务核心</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">服务状态</span>
            <span className="settings-row-control">
              <span className={`dialog-status-pill ${health?.status === 'ok' ? 'success' : 'warning'}`}>
                {health?.status === 'ok' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {health?.status === 'ok' ? '正常运行' : '部分降级'}
              </span>
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">系统版本</span>
            <span className="settings-row-control" style={{ fontFamily: 'var(--font-mono, monospace)' }}>
              v{health?.version || '—'}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">默认竞赛</span>
            <span className="settings-row-control" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {health?.default_competition || '—'}
            </span>
          </div>
          {health?.active_competition?.competition && (
            <div className="settings-row">
              <span className="settings-row-label">活动主工作区</span>
              <span className="settings-row-control" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#007aff', fontWeight: 600 }}>
                {health.active_competition.competition}
              </span>
            </div>
          )}
        </div>

        {/* 2. Kaggle CLI & 环境 */}
        <div className="settings-group">
          <div className="settings-group-header">
            <Terminal size={14} />
            <span>Kaggle CLI & 运行环境</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Kaggle CLI</span>
            <span className="settings-row-control">
              <span className={`dialog-status-pill ${health?.kaggle_cli ? 'success' : 'error'}`}>
                {health?.kaggle_cli ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                {health?.kaggle_cli ? '已就绪' : '未检测到'}
              </span>
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Kaggle API 凭据</span>
            <span className="settings-row-control">
              <span className={`dialog-status-pill ${health?.token_configured ? 'success' : 'error'}`}>
                {health?.token_configured ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                {health?.token_configured ? '已配置 (kaggle.json)' : '未配置'}
              </span>
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">UTF-8 输出保护</span>
            <span className="settings-row-control">
              <span className={`dialog-status-pill ${health?.utf8_wrapper_exists ? 'success' : 'warning'}`}>
                {health?.utf8_wrapper_exists ? '已就绪' : '未配置'}
              </span>
            </span>
          </div>
        </div>

        {/* 3. 归档与存储 (Archive) */}
        {health?.archive && (
          <div className="settings-group">
            <div className="settings-group-header">
              <HardDrive size={14} />
              <span>本地存储与归档 (Storage)</span>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">归档总版本数</span>
              <span className="settings-row-control" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {health.archive.total_archives} 个版本
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">唯一 Kernel 数</span>
              <span className="settings-row-control" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {health.archive.unique_kernels} 个 Kernel
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">磁盘剩余可用空间</span>
              <span
                className="settings-row-control"
                style={{
                  color: health.archive.low_disk_space ? '#ef4444' : '#1c1c1e',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatBytes(health.archive.disk_free_bytes)}
                {health.archive.low_disk_space && ' (低磁盘空间)'}
              </span>
            </div>
          </div>
        )}

        {/* 4. 后台调度监控 (Monitor) */}
        <div className="settings-group">
          <div className="settings-group-header">
            <Radio size={14} />
            <span>后台任务调度 (Scheduler)</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">自动归档服务</span>
            <span className="settings-row-control">
              <span className={`dialog-status-pill ${health?.auto_archive?.running ? 'active' : 'default'}`}>
                {health?.auto_archive?.running ? '运行中' : '未启用'}
              </span>
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">提交出分监控</span>
            <span className="settings-row-control">
              <span className={`dialog-status-pill ${health?.submission_monitor?.running ? 'active' : 'default'}`}>
                {health?.submission_monitor?.running ? '运行中' : '未启用'}
              </span>
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">天梯对抗监控</span>
            <span className="settings-row-control">
              <span className={`dialog-status-pill ${health?.simulation_monitor?.running ? 'active' : 'default'}`}>
                {health?.simulation_monitor?.running ? '运行中' : '未启用'}
              </span>
            </span>
          </div>
        </div>

        {/* 5. 通知与鉴权 (Notification & Security) */}
        <div className="settings-group">
          <div className="settings-group-header">
            <Bell size={14} />
            <span>通知渠道与访问控制 (Security)</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">通知推送进程</span>
            <span className="settings-row-control">
              <span className={`dialog-status-pill ${health?.notifications?.worker_alive ? 'success' : 'default'}`}>
                {health?.notifications?.worker_alive ? <CheckCircle2 size={12} /> : null}
                {health?.notifications?.worker_alive ? '运行中' : '未就绪'}
              </span>
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">浏览器 API 密钥</span>
            <span className="settings-row-control">
              <span className={`dialog-status-pill ${apiAuth.getKey() ? 'active' : 'default'}`}>
                {apiAuth.getKey() ? <KeyRound size={12} /> : null}
                {apiAuth.getKey() ? '已保存凭据' : '无凭据'}
              </span>
            </span>
          </div>
          {Boolean(apiAuth.getKey()) && (
            <div style={{ padding: '8px 14px 12px 14px' }}>
              <Button danger icon={<LogOut size={14} />} onClick={onForgetApiKey} block style={{ height: 38, borderRadius: 10 }}>
                清除浏览器中保存的 API 访问密钥
              </Button>
            </div>
          )}
        </div>

        {/* 6. 异常报警 (Errors) */}
        {errors.length > 0 && (
          <div className="settings-group" style={{ borderColor: 'rgba(239, 68, 68, 0.25)', background: 'rgba(254, 242, 242, 0.6)' }}>
            <div className="settings-group-header" style={{ color: '#ef4444' }}>
              <AlertCircle size={14} />
              <span>近期异常与告警记录</span>
            </div>
            {errors.map((item, idx) => (
              <div key={idx} className="settings-row" style={{ alignItems: 'flex-start', padding: '10px 14px' }}>
                <span className="settings-row-label" style={{ minWidth: 80, color: '#b91c1c', fontWeight: 600 }}>
                  {item.source}
                </span>
                <span className="settings-row-control" style={{ fontSize: 12, color: '#7f1d1d', wordBreak: 'break-all', textAlign: 'left' }}>
                  {item.error}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
};

export default RuntimeDiagnosticsDrawer;
