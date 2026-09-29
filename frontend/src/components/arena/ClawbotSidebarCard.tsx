import React from 'react';
import { Button, Card, Space, Tag, Tooltip, Typography } from 'antd';
import { Bot, RefreshCw, Smartphone } from 'lucide-react';
import type { SimulationClawbotStatus } from '../../types/api';

const { Text, Paragraph } = Typography;

interface ClawbotSidebarCardProps {
  clawbot?: SimulationClawbotStatus | null;
  testingClawbot: boolean;
  onTestClawbot: () => Promise<void>;
  isStandby?: boolean;
  isFinished?: boolean;
  selectedCompetition?: string;
  diskFreeGB: string | number;
  healthReady?: boolean;
}

export const ClawbotSidebarCard: React.FC<ClawbotSidebarCardProps> = ({
  clawbot,
  testingClawbot,
  onTestClawbot,
  isStandby = false,
  isFinished = false,
  selectedCompetition,
  diskFreeGB,
  healthReady = false,
}) => {
  return (
    <Card
      className="dashboard-glow-card"
      style={{
        height: '100%',
        borderRadius: 14,
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.03)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
      styles={{ body: { padding: '20px 22px', display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Space align="center" size={8}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dcfce7', display: 'grid', placeItems: 'center' }}>
              <Bot size={18} color="#16a34a" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                微信 ClawBot 智能管家
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                官方长连接 · 实时问答与战报推送
              </Text>
            </div>
          </Space>

          <Space size={6}>
            <Button
              size="small"
              icon={<RefreshCw size={12} className={testingClawbot ? 'animate-spin' : ''} />}
              loading={testingClawbot}
              onClick={() => void onTestClawbot()}
              style={{ fontSize: 12 }}
            >
              探测连通性
            </Button>
            <Tooltip
              title={
                clawbot?.is_online
                  ? 'OpenClaw 网关正在运行并保持微信长连接'
                  : clawbot?.configured
                  ? '已配置模型与插件，但本地/服务器 18789 端口未检测到 OpenClaw 网关运行'
                  : '未检测到 OpenClaw 配置文件或 OPENCLAW_LLM_API_KEY 环境变量'
              }
            >
              <Tag
                color={clawbot?.is_online ? 'success' : clawbot?.configured ? 'warning' : 'default'}
                style={{ margin: 0, fontWeight: 700 }}
              >
                {clawbot?.is_online ? '在线' : clawbot?.configured ? '离线 (未启动)' : '未就绪'}
              </Tag>
            </Tooltip>
          </Space>
        </div>

        {/* Model & Config Details */}
        <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px', marginBottom: 14, border: '1px solid #f1f5f9' }}>
          {isStandby && selectedCompetition && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: '#64748b' }}>关注赛事:</span>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{selectedCompetition}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
            <span style={{ color: '#64748b' }}>大模型引擎:</span>
            <span style={{ fontWeight: 700, color: '#0f172a' }}>{clawbot?.model || 'deepseek-v4-flash-0731'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
            <span style={{ color: '#64748b' }}>服务商:</span>
            <span style={{ color: '#334155' }}>{clawbot?.provider || 'TokenRhythm Studio'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
            <span style={{ color: '#64748b' }}>网关探测:</span>
            <span style={{ color: clawbot?.is_online ? '#16a34a' : '#d97706', fontWeight: 600 }}>
              {clawbot?.is_online ? '活跃 (端口 18789)' : '未连接 (端口 18789)'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: '#64748b' }}>对战巡检状态:</span>
            <span style={{ color: isStandby ? '#0284c7' : isFinished ? '#64748b' : '#16a34a', fontWeight: 600 }}>
              {isStandby ? '休眠待命中' : isFinished ? '比赛已封榜 · 自动巡检休眠' : '每 10 分钟自动检查对局'}
            </span>
          </div>
        </div>

        {/* WeChat Commands Quick List */}
        <div style={{ fontSize: 12, color: '#475569', marginBottom: 14 }}>
          <Space size={6} style={{ marginBottom: 6 }}>
            <Smartphone size={14} color="#0284c7" />
            <span style={{ fontWeight: 600, color: '#0f172a' }}>
              {isStandby ? '手机微信随时可用：' : '手机微信直接发送指令：'}
            </span>
          </Space>
          {isStandby && (
            <Paragraph type="secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
              在手机微信向管家发送指令，随时查询竞赛信息或唤醒对局巡检。
            </Paragraph>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Tag color="blue">战况</Tag>
            <Tag color="gold">分数</Tag>
            <Tag color="purple">排名</Tag>
            <Tag color="cyan">刷新</Tag>
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          磁盘空间: <span style={{ fontWeight: 600, color: '#0f172a' }}>{diskFreeGB} GB</span> 可用
        </Text>
        <Tag color={healthReady ? 'green' : 'orange'}>
          {healthReady ? 'CLI 凭据已就绪' : '检查凭据'}
        </Tag>
      </div>
    </Card>
  );
};

export default ClawbotSidebarCard;
