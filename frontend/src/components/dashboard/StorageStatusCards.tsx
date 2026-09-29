import React from 'react';
import { Button, Card, Col, Row, Space, Tag } from 'antd';
import { AlertCircle, CheckCircle2, HardDrive } from 'lucide-react';
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
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Space align="center" size={8}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: '#f1f5f9', display: 'grid', placeItems: 'center' }}>
            <HardDrive size={16} color="#475569" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>
            本地存储与服务就绪态势
          </span>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Stat 1: 本地归档资产 */}
        <Col xs={24} md={8}>
          <Card
            size="small"
            className="dashboard-glow-card"
            style={{
              height: '100%',
              minHeight: 116,
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
            styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' } }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>本地已归档资产</span>
                <Button
                  type="link"
                  size="small"
                  onClick={() => onNavigate('/archives')}
                  style={{ padding: 0, fontWeight: 600, color: '#1677ff', height: 'auto', lineHeight: 'normal' }}
                >
                  查看归档 →
                </Button>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minHeight: 30 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: '#0f172a' }}>
                  {archiveStats?.total_archives ?? health?.archive?.total_archives ?? 0}
                </span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>个版本</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  ({archiveStats?.unique_kernels ?? health?.archive?.unique_kernels ?? 0} 个 Kernel)
                </span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, paddingTop: 8, borderTop: '1px solid #f8fafc' }}>
              占用: {formatBytes(archiveStats?.total_size_bytes ?? 0)} · 跨 {archiveStats?.unique_competitions ?? 1} 场竞赛
            </div>
          </Card>
        </Col>

        {/* Stat 2: 磁盘剩余容量 */}
        <Col xs={24} md={8}>
          <Card
            size="small"
            className="dashboard-glow-card"
            style={{
              height: '100%',
              minHeight: 116,
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
            styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' } }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>本地磁盘可用容量</span>
                <HardDrive size={16} color="#94a3b8" />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minHeight: 30 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: archiveStats?.low_disk_space ? '#ef4444' : '#0f172a' }}>
                  {formatBytes(archiveStats?.disk_free_bytes ?? health?.archive?.disk_free_bytes ?? 0)}
                </span>
                {archiveStats?.low_disk_space ? (
                  <Tag color="error" style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>磁盘紧缺</Tag>
                ) : (
                  <Tag color="success" style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>空间充裕</Tag>
                )}
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, paddingTop: 8, borderTop: '1px solid #f8fafc' }}>
              保护阈值: 2.0 GB · 低于阈值将暂停自动下载
            </div>
          </Card>
        </Col>

        {/* Stat 3: 后端引擎状态 */}
        <Col xs={24} md={8}>
          <Card
            size="small"
            className="dashboard-glow-card"
            style={{
              height: '100%',
              minHeight: 116,
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
            styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' } }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>后端与 Kaggle CLI</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 30 }}>
                {health?.ready ? (
                  <>
                    <CheckCircle2 size={18} color="#16a34a" />
                    <span style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>正常在线 · 就绪</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={18} color="#f59e0b" />
                    <span style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>环境就绪中</span>
                  </>
                )}
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, paddingTop: 8, borderTop: '1px solid #f8fafc' }}>
              CLI: {health?.kaggle_cli ? '已就绪' : '未检测到'} · Token: {health?.token_configured ? '已配置' : '未配置'}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default StorageStatusCards;
