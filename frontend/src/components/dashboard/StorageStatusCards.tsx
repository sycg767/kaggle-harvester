import React from 'react';
import { Button } from 'antd';
import { Activity, Archive, HardDrive } from 'lucide-react';
import type { ArchiveStats, HealthStatus } from '../../api';
import { formatBytes } from './dashboardUtils';

interface StorageStatusCardsProps {
  archiveStats: ArchiveStats | null;
  health: HealthStatus | null;
  onNavigate: (path: string) => void;
}

export const StorageStatusCards: React.FC<StorageStatusCardsProps> = ({
  archiveStats,
  health,
  onNavigate,
}) => {
  const totalArchives = archiveStats?.total_archives ?? health?.archive?.total_archives;
  const uniqueKernels = archiveStats?.unique_kernels ?? health?.archive?.unique_kernels;
  const totalSizeBytes = archiveStats?.total_size_bytes;
  const diskFreeBytes = archiveStats?.disk_free_bytes ?? health?.archive?.disk_free_bytes;
  const lowDiskSpace = archiveStats?.low_disk_space ?? health?.archive?.low_disk_space;

  return (
    <section className="section" style={{ marginBottom: 14 }}>
      <div className="ios-section-head">
        <div className="ios-section-title">
          <span
            className="ios-section-symbol"
            style={{ background: 'rgba(118, 118, 128, 0.08)', color: '#57575d' }}
          >
            <HardDrive size={15} />
          </span>
          <span>服务器存储与服务状态（全部赛事）</span>
        </div>
      </div>

      <div className="ios-status-grid">
        {/* Stat 1: 本地归档资产 */}
        <article className="ios-status-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="ios-status-title">服务器已归档资产</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                type="link"
                size="small"
                onClick={() => onNavigate('/archives')}
                style={{
                  padding: 0,
                  fontWeight: 600,
                  color: 'var(--ios-blue)',
                  height: 'auto',
                  lineHeight: 'normal',
                  fontSize: 12,
                }}
              >
                查看归档 →
              </Button>
              <Archive size={17} color="#8e8e93" style={{ opacity: 0.7 }} />
            </div>
          </div>

          <div className="ios-status-number">
            {totalArchives ?? '—'}{' '}
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)' }}>
              个版本
            </span>
          </div>

          <div className="ios-status-caption">
            {uniqueKernels ?? '—'} 个 Kernel · 占用 {totalSizeBytes == null ? '未知' : formatBytes(totalSizeBytes)}
          </div>
        </article>

        {/* Stat 2: 磁盘剩余容量 */}
        <article className="ios-status-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="ios-status-title">服务器磁盘可用容量</span>
            <HardDrive size={17} color="#8e8e93" style={{ opacity: 0.7 }} />
          </div>

          <div
            className="ios-status-number"
            style={{ color: lowDiskSpace ? 'var(--ios-red)' : 'var(--text-primary)' }}
          >
            {diskFreeBytes == null ? '未知' : formatBytes(diskFreeBytes)}
          </div>

          <div className="ios-status-caption">
            {lowDiskSpace == null ? '容量状态未知' : lowDiskSpace ? '磁盘紧缺 · 保护阈值 2.0 GB' : '空间充裕 · 保护阈值 2.0 GB'}
          </div>
        </article>

        {/* Stat 3: 后端引擎与环境状态 */}
        <article className="ios-status-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="ios-status-title">后端与 Kaggle CLI</span>
            <Activity size={17} color="#8e8e93" style={{ opacity: 0.7 }} />
          </div>

          <div className="ios-system-online">
            <span className={`big-dot ${health?.ready ? '' : 'warning'}`} />
            <span>{health == null ? '状态未知' : health.ready ? '环境已就绪' : '环境未就绪'}</span>
          </div>

          <div className="ios-status-caption">
            CLI: {health == null ? '未知' : health.kaggle_cli ? '已就绪' : '未检测到'} · Token:{' '}
            {health == null ? '未知' : health.token_configured ? '已配置' : '未配置'}
          </div>
        </article>
      </div>
    </section>
  );
};

export default StorageStatusCards;
