import React from 'react';
import { Button, Card, Space, Tag, Tooltip, Typography } from 'antd';
import { Bot, RefreshCw, Smartphone } from 'lucide-react';
import type { SimulationClawbotStatus } from '../../types/api';

const { Text } = Typography;

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
      className="arena-panel arena-clawbot-card"
      styles={{ body: { padding: '20px 22px', display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      <div className="arena-clawbot-body">
        <div className="arena-clawbot-header">
          <div className="arena-clawbot-title-group">
            <div className="arena-clawbot-icon-tile">
              <Bot size={18} color="#34c759" />
            </div>
            <div>
              <div className="arena-clawbot-title">
                微信 ClawBot 智能管家
              </div>
              <div className="arena-clawbot-desc">
                官方长连接 · 实时问答与战报推送
              </div>
            </div>
          </div>

          <div className="arena-clawbot-actions">
            <Button
              size="small"
              icon={<RefreshCw size={12} className={testingClawbot ? 'animate-spin' : ''} />}
              loading={testingClawbot}
              onClick={() => void onTestClawbot()}
              className="arena-clawbot-test-btn"
            >
              探测
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
                className="arena-clawbot-status-tag"
              >
                {clawbot?.is_online ? '在线' : clawbot?.configured ? '离线' : '未就绪'}
              </Tag>
            </Tooltip>
          </div>
        </div>

        {/* Model & Config Details */}
        <div className="arena-clawbot-details">
          {isStandby && selectedCompetition && (
            <div className="arena-clawbot-row">
              <span className="arena-clawbot-label">关注赛事:</span>
              <span className="arena-clawbot-value bold">{selectedCompetition}</span>
            </div>
          )}
          <div className="arena-clawbot-row">
            <span className="arena-clawbot-label">大模型引擎:</span>
            <span className="arena-clawbot-value bold">{clawbot?.model || 'deepseek-v4-flash-0731'}</span>
          </div>
          <div className="arena-clawbot-row">
            <span className="arena-clawbot-label">服务商:</span>
            <span className="arena-clawbot-value">{clawbot?.provider || 'TokenRhythm Studio'}</span>
          </div>
          <div className="arena-clawbot-row">
            <span className="arena-clawbot-label">网关探测:</span>
            <span className={`arena-clawbot-value ${clawbot?.is_online ? 'online' : 'offline'}`}>
              {clawbot?.is_online ? '活跃 (端口 18789)' : '未连接 (端口 18789)'}
            </span>
          </div>
          <div className="arena-clawbot-row">
            <span className="arena-clawbot-label">对战巡检状态:</span>
            <span className={`arena-clawbot-value ${isStandby ? 'standby' : isFinished ? 'finished' : 'online'}`}>
              {isStandby ? '休眠待命中' : isFinished ? '已封榜 · 自动巡检休眠' : '每 10 分钟自动检查'}
            </span>
          </div>
        </div>

        {/* WeChat Commands Quick List */}
        <div className="arena-clawbot-commands-section">
          <div className="arena-clawbot-commands-header">
            <Smartphone size={13} color="#007aff" />
            <span>微信快捷指令</span>
          </div>
          <div className="arena-clawbot-chips">
            <span className="arena-command-chip">战况</span>
            <span className="arena-command-chip">分数</span>
            <span className="arena-command-chip">排名</span>
            <span className="arena-command-chip">刷新</span>
          </div>
        </div>
      </div>

      <div className="arena-clawbot-footer">
        <span className="arena-clawbot-disk">
          磁盘空间: <strong>{diskFreeGB} GB</strong> 可用
        </span>
        <Tag color={healthReady ? 'green' : 'orange'} className="arena-clawbot-cli-tag">
          {healthReady ? 'CLI 就绪' : '检查凭据'}
        </Tag>
      </div>
    </Card>
  );
};

export default ClawbotSidebarCard;

