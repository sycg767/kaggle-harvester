import React from 'react';
import { Button, Card, Col, Row, Tag } from 'antd';
import { Award, Calendar, LayoutDashboard, Swords, Users, Zap, Clock, Trophy, Medal } from 'lucide-react';
import type {
  CompetitionInfo,
  EnteredCompetition,
} from '../../types/api';
import { calculateMedalRanks } from './medalRules';
import SimulationMonitorControl from '../SimulationMonitorControl';

interface ArenaStandbyViewProps {
  selectedCompetition: string;
  currentTitle: string;
  compInfo: CompetitionInfo | null;
  currentEnteredMeta?: EnteredCompetition;
  isFinished: boolean;
  formatDate: (val?: string) => string;
  onNavigateToKernels: () => void;
}

export const ArenaStandbyView: React.FC<ArenaStandbyViewProps> = ({
  selectedCompetition,
  currentTitle,
  compInfo,
  currentEnteredMeta,
  isFinished,
  formatDate,
  onNavigateToKernels,
}) => {
  const totalTeams = compInfo?.team_count ?? currentEnteredMeta?.team_count ?? 0;
  const { goldRank, silverRank, bronzeRank } = calculateMedalRanks(totalTeams);

  return (
    <div className="arena-standby-stack" style={{ width: '100%' }}>
      <Card
        className="arena-panel arena-standby-panel"
        styles={{ body: { padding: '20px 22px' } }}
      >
          {/* Competition Header Info */}
          <div className="arena-standby-header">
            <div className="arena-standby-title-group">
              <div className="arena-standby-icon-tile">
                <Swords size={20} color="#007aff" />
              </div>
              <div className="arena-standby-title-text">
                <div className="arena-standby-name-row">
                  <span className="arena-standby-name">
                    {currentTitle}
                  </span>
                  <Tag color="blue" className="arena-category-tag">
                    {compInfo?.category || currentEnteredMeta?.category || '竞赛'}
                  </Tag>
                  <Tag color="orange" className="arena-standby-status-tag">
                    <Clock size={11} style={{ marginRight: 3 }} />
                    <span>{isFinished ? '暂无历史快照' : '暂无对应数据'}</span>
                  </Tag>
                </div>
                <div className="arena-standby-comp-id">
                  比赛 ID：<code>{selectedCompetition}</code>
                </div>
              </div>
            </div>
          </div>

          {/* Competition Metadata Quick Cards */}
          <Row gutter={[10, 10]} className="arena-standby-meta-row">
            <Col xs={24} sm={8}>
              <div className="arena-meta-box">
                <div className="arena-meta-box-label">
                  <Calendar size={13} color="#8e8e93" />
                  <span>截止时间</span>
                </div>
                <div className="arena-meta-box-value">
                  {formatDate(compInfo?.deadline || currentEnteredMeta?.deadline)}
                </div>
              </div>
            </Col>

            <Col xs={24} sm={8}>
              <div className="arena-meta-box">
                <div className="arena-meta-box-label">
                  <Users size={13} color="#8e8e93" />
                  <span>参赛队伍数</span>
                </div>
                <div className="arena-meta-box-value">
                  {totalTeams > 0 ? `${totalTeams.toLocaleString()} 支队伍` : '—'}
                </div>
              </div>
            </Col>

            <Col xs={24} sm={8}>
              <div className="arena-meta-box">
                <div className="arena-meta-box-label">
                  <Award size={13} color="#8e8e93" />
                  <span>奖金池 / 荣誉</span>
                </div>
                <div className="arena-meta-box-value">
                  {compInfo?.reward || currentEnteredMeta?.reward || '—'}
                </div>
              </div>
            </Col>
          </Row>

          {/* Official Medal Cutoffs */}
          <div className="arena-standby-cutoffs">
            <div className="arena-standby-cutoffs-header">
              <Award size={14} color="#007aff" />
              <span className="arena-standby-cutoffs-title">
                按通用规则估算席位（以赛事规则为准） {totalTeams > 0 ? `(共 ${totalTeams.toLocaleString()} 支队伍)` : ''}
              </span>
            </div>
            <Row gutter={[8, 8]}>
              <Col xs={8}>
                <div className="arena-standby-tier-box gold">
                  <div className="arena-standby-tier-label">
                    <Trophy size={11} color="#ca8a04" />
                    <span>金牌区</span>
                  </div>
                  <div className="arena-standby-tier-val">
                    Top {totalTeams > 0 && goldRank > 0 ? goldRank : '—'}
                  </div>
                </div>
              </Col>
              <Col xs={8}>
                <div className="arena-standby-tier-box silver">
                  <div className="arena-standby-tier-label">
                    <Medal size={11} color="#0284c7" />
                    <span>银牌区</span>
                  </div>
                  <div className="arena-standby-tier-val">
                    Top {totalTeams > 0 && silverRank > 0 ? silverRank : '—'}
                  </div>
                </div>
              </Col>
              <Col xs={8}>
                <div className="arena-standby-tier-box bronze">
                  <div className="arena-standby-tier-label">
                    <Award size={11} color="#d97706" />
                    <span>铜牌区</span>
                  </div>
                  <div className="arena-standby-tier-val">
                    Top {totalTeams > 0 && bronzeRank > 0 ? bronzeRank : '—'}
                  </div>
                </div>
              </Col>
            </Row>
          </div>

          {/* Action & Standby Control Strip */}
          <div className="arena-standby-actions-strip">
            <div className="arena-standby-action-hint">
              <Zap size={16} color="#ff9500" />
              <div>
                <div className="arena-standby-action-title">
                  {isFinished ? '赛事已截止，尚未找到已保存的对战快照' : '当前赛事尚无可展示的 Agent 数据'}
                </div>
                <div className="arena-standby-action-desc">
                  {isFinished ? '仅有赛事基本信息；不会使用其他赛事的分数或自动切换后台监控。' : '请检查监控赛事、Submission ID 和最近采集结果'}
                </div>
              </div>
            </div>

            <div className="arena-standby-buttons">
              <SimulationMonitorControl
                currentCompetition={selectedCompetition}
                buttonType="primary"
                buttonText={isFinished ? '查看监控配置' : '开启对战监控'}
              />
              <Button
                icon={<LayoutDashboard size={14} />}
                onClick={onNavigateToKernels}
              >
                Kernel 广场
              </Button>
            </div>
          </div>
        </Card>
    </div>
  );
};

export default ArenaStandbyView;

