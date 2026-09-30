import React from 'react';
import { Button, Select, Tooltip } from 'antd';
import { Activity, Archive, LayoutDashboard, Star, Swords } from 'lucide-react';
import type { CompetitionInfo } from '../../api';

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
  const displayTitle = competitionInfo?.title || currentCompetition || '赛事全景态势';

  return (
    <section className="ios-hero-banner">
      <div className="ios-hero-top">
        <div className="ios-hero-eyebrow">
          <span className={`ios-hero-chip ${isSimulation ? 'orange' : 'blue'}`}>
            {isSimulation ? <Swords size={12} /> : <Activity size={12} />}
            {isSimulation ? '智能体博弈 · Simulation' : '标准赛题 · 预测建模'}
          </span>
          {competitionInfo?.team_count ? (
            <span className="ios-hero-chip gray">
              {competitionInfo.team_count.toLocaleString()} 支队伍参赛
            </span>
          ) : null}
          {competitionInfo?.kernel_count ? (
            <span className="ios-hero-chip gray">
              {competitionInfo.kernel_count} 篇开源代码
            </span>
          ) : null}
        </div>
        <span className="ios-hero-chip gray desktop-only">当前赛事工作区</span>
      </div>

      <h1 className="ios-hero-title">{displayTitle}</h1>
      <div className="ios-hero-sub">
        {isSimulation
          ? '当前处于对抗竞技模式，配置监控后可查看 Agent 排名、最近对局和奖牌线快照。'
          : '查看本赛事提交、发现代码并归档版本；自动化任务按各自保存的赛事范围执行。'}
      </div>

      <div className="ios-hero-bottom">
        <div className="ios-hero-primary">
          <Select
            value={currentCompetition}
            onChange={onSelectCompetition}
            options={competitionOptions}
            className="ios-hero-select"
            size="large"
            showSearch
            placeholder="切换当前竞赛..."
          />
          <div className="ios-hero-pinned-wrap">
            <Tooltip title={isPinned ? '已固定为主攻赛事（新设备默认展示）' : '设为全站主攻赛事'}>
              <Button
                className={`ios-btn ios-hero-pinned-btn ${isPinned ? 'ios-btn-pinned' : 'ios-btn-secondary'}`}
                icon={<Star size={14} fill={isPinned ? 'currentColor' : 'none'} />}
                loading={togglingPin}
                onClick={onTogglePin}
              >
                {isPinned ? '已设为主攻' : '设为主攻'}
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="ios-hero-quick-actions">
          {isSimulation ? (
            <Button
              type="primary"
              className="ios-btn ios-btn-orange"
              icon={<Swords size={15} />}
              onClick={() => onNavigate('/arena')}
            >
              天梯对抗
            </Button>
          ) : null}
          <Button
            type="primary"
            className="ios-btn ios-btn-primary"
            icon={<LayoutDashboard size={15} />}
            onClick={() => onNavigate('/kernels')}
          >
            代码发现
          </Button>
          <Button
            className="ios-btn ios-btn-ghost"
            icon={<Archive size={15} />}
            onClick={() => onNavigate('/archives')}
          >
            服务器归档
          </Button>
        </div>
      </div>
    </section>
  );
};

export default CompetitionHeroBanner;
