import React from 'react';
import { Button, Card, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { Activity, Archive, LayoutDashboard, Star, Swords } from 'lucide-react';
import type { CompetitionInfo } from '../../api';

const { Text } = Typography;

interface CompetitionHeroBannerProps {
  isSimulation: boolean;
  competitionInfo: CompetitionInfo | null;
  currentCompetition: string;
  onSelectCompetition: (value: string) => void;
  competitionOptions: Array<{ value: string; label: React.ReactNode }>;
  isPinned?: boolean;
  togglingPin: boolean;
  onTogglePin: () => void;
  onNavigate: (path: string) => void;
}

export const CompetitionHeroBanner: React.FC<CompetitionHeroBannerProps> = ({
  isSimulation,
  competitionInfo,
  currentCompetition,
  onSelectCompetition,
  competitionOptions,
  isPinned = false,
  togglingPin,
  onTogglePin,
  onNavigate,
}) => {
  return (
    <Card
      className="dashboard-glow-card dashboard-hero-card"
      style={{
        marginBottom: 20,
        borderRadius: 10,
        border: '1px solid #e2e8f0',
        background: '#ffffff',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
      }}
      styles={{ body: { padding: '20px 24px' } }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          {/* Meta labels */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <Tag
              color={isSimulation ? 'gold' : 'blue'}
              style={{ margin: 0, fontWeight: 600, borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {isSimulation ? <Swords size={13} /> : <Activity size={13} />}
              {isSimulation ? '智能体博弈 · Simulation' : '标准赛题 · 预测建模'}
            </Tag>
            {competitionInfo?.team_count ? (
              <Tag style={{ margin: 0, borderRadius: 4 }}>
                {competitionInfo.team_count} 支队伍参赛
              </Tag>
            ) : null}
            {competitionInfo?.kernel_count ? (
              <Tag style={{ margin: 0, borderRadius: 4 }}>
                {competitionInfo.kernel_count} 篇开源代码
              </Tag>
            ) : null}
          </div>

          {/* Primary Competition Switcher Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <Select
              value={currentCompetition}
              onChange={onSelectCompetition}
              options={competitionOptions}
              style={{ minWidth: 360, maxWidth: 560 }}
              size="large"
              showSearch
              placeholder="切换当前竞赛..."
            />
            <Tooltip title={isPinned ? '已固定为主攻赛事（新设备默认展示）' : '设为全站主攻赛事'}>
              <Button
                type={isPinned ? 'primary' : 'default'}
                icon={<Star size={14} fill={isPinned ? '#ffffff' : 'none'} />}
                loading={togglingPin}
                onClick={onTogglePin}
                style={{ height: 40, borderRadius: 8, fontWeight: 500 }}
              >
                {isPinned ? '已设为主攻' : '☆ 设为主攻'}
              </Button>
            </Tooltip>
          </div>

          <Text type="secondary" style={{ fontSize: 13, display: 'block', maxWidth: 760, lineHeight: 1.6 }}>
            {isSimulation
              ? '当前处于对抗竞技模式，后台实时追踪双 Agent 天梯胜率、对局流水战报与金银铜牌安全垫线。'
              : '当前处于标准竞赛模式，支持自动化监控自提交最新出分，优先开源高分 Notebooks 智能归档与依赖提取。'}
          </Text>
        </div>

        {/* Direct Workspace Jump Action Pills */}
        <Space wrap size={10} style={{ alignSelf: 'center' }}>
          {isSimulation ? (
            <Button
              type="primary"
              icon={<Swords size={15} />}
              onClick={() => onNavigate('/arena')}
              style={{ height: 38, borderRadius: 8, fontWeight: 600, background: '#d97706', borderColor: '#d97706' }}
            >
              天梯对抗专页
            </Button>
          ) : null}
          <Button
            type="primary"
            icon={<LayoutDashboard size={15} />}
            onClick={() => onNavigate('/kernels')}
            style={{ height: 38, borderRadius: 8, fontWeight: 600 }}
          >
            开源代码广场
          </Button>
          <Button
            icon={<Archive size={15} />}
            onClick={() => onNavigate('/archives')}
            style={{ height: 38, borderRadius: 8, fontWeight: 600 }}
          >
            本地归档仓库
          </Button>
        </Space>
      </div>
    </Card>
  );
};

export default CompetitionHeroBanner;
