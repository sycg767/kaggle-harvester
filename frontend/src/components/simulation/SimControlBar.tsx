import React from 'react';
import { Button, Space, Tag, Tooltip, Typography } from 'antd';
import { HistoryOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { MessageCircle } from 'lucide-react';
import type { SimulationMonitorSnapshot } from '../../types/api';
import { formatDate } from './utils';

const { Text } = Typography;

interface SimControlBarProps {
  isTargetCompActive: boolean;
  isMonitoringActive: boolean;
  status?: SimulationMonitorSnapshot['status'];
  config?: SimulationMonitorSnapshot['config'];
  targetCompTitle: string;
  targetCompetition: string;
  runningNow: boolean;
  loadingSubmissions: boolean;
  onOpenClawbot: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onRunNow: () => void;
  onRefreshSubmissions: () => void;
}

export const SimControlBar: React.FC<SimControlBarProps> = ({
  isTargetCompActive,
  isMonitoringActive,
  status,
  config,
  targetCompTitle,
  runningNow,
  loadingSubmissions,
  onOpenClawbot,
  onOpenSettings,
  onOpenHistory,
  onRunNow,
  onRefreshSubmissions,
}) => {
  return (
    <div className="sim-control-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: isTargetCompActive
                ? isMonitoringActive
                  ? '#10b981'
                  : '#94a3b8'
                : isMonitoringActive
                ? '#f59e0b'
                : '#94a3b8',
              boxShadow:
                isTargetCompActive && isMonitoringActive
                  ? '0 0 0 3px rgba(16, 185, 129, 0.2)'
                  : 'none',
            }}
          />
          <Text
            strong
            style={{
              fontSize: 13,
              color: isTargetCompActive && isMonitoringActive ? '#0f172a' : '#64748b',
            }}
          >
            {isTargetCompActive
              ? isMonitoringActive
                ? status?.running
                  ? '正在执行检查中...'
                  : `后台调度监控中 (${config?.interval_minutes || 10} 分钟/次)`
                : '后台监控已暂停 (定时关闭)'
              : isMonitoringActive
              ? `后台正监控其他赛事 (${config?.competition})`
              : `【${targetCompTitle}】待命备战态 (后台巡检未开启)`}
          </Text>
        </div>

        <Tooltip title="点击查看微信 ClawBot 智能体状态与指令指南">
          <Tag
            color={
              status?.clawbot?.is_online
                ? 'success'
                : status?.clawbot?.configured
                ? 'warning'
                : 'default'
            }
            style={{
              cursor: 'pointer',
              borderRadius: 12,
              padding: '2px 10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontWeight: 600,
              fontSize: 12,
            }}
            onClick={onOpenClawbot}
          >
            <MessageCircle size={13} />
            微信 ClawBot:{' '}
            {status?.clawbot?.is_online
              ? `在线 (${status?.clawbot?.model || 'DeepSeek'})`
              : status?.clawbot?.configured
              ? '离线 (未启动)'
              : '未连接'}
          </Tag>
        </Tooltip>

        {isTargetCompActive ? (
          <>
            <Text type="secondary" style={{ fontSize: 12 }}>
              上次检查: {formatDate(status?.last_checked_at)}
            </Text>

            {isMonitoringActive && status?.next_run_at && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                下次检查: {formatDate(status?.next_run_at)}
              </Text>
            )}
          </>
        ) : isMonitoringActive ? (
          <Tag color="orange" style={{ margin: 0 }}>
            后台正在监控: {config?.competition}
          </Tag>
        ) : (
          <Tag color="default" style={{ margin: 0 }}>
            后台巡检: 未开启
          </Tag>
        )}
      </div>

      <Space size={8}>
        <Button
          type={!isTargetCompActive || !isMonitoringActive ? 'primary' : 'default'}
          size="small"
          icon={<SettingOutlined />}
          onClick={onOpenSettings}
        >
          {!isTargetCompActive || !isMonitoringActive ? '配置并开启监控' : '监控配置'}
        </Button>
        <Button size="small" icon={<HistoryOutlined />} onClick={onOpenHistory}>
          检查日志
        </Button>
        {isTargetCompActive ? (
          <Button
            type="primary"
            size="small"
            icon={<ReloadOutlined spin={runningNow} />}
            loading={runningNow}
            onClick={onRunNow}
          >
            立即刷新
          </Button>
        ) : (
          <Button
            size="small"
            icon={<ReloadOutlined spin={loadingSubmissions} />}
            loading={loadingSubmissions}
            onClick={onRefreshSubmissions}
          >
            刷新候选提交
          </Button>
        )}
      </Space>
    </div>
  );
};

export default SimControlBar;
