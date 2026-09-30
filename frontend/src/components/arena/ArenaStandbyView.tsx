import React from 'react';
import { Button, Card, Col, Row, Space, Tag, Typography } from 'antd';
import { Award, Calendar, LayoutDashboard, Swords, Users, Zap } from 'lucide-react';
import type {
  CompetitionInfo,
  EnteredCompetition,
  SimulationClawbotStatus,
} from '../../types/api';
import ClawbotSidebarCard from './ClawbotSidebarCard';
import { calculateMedalRanks } from './medalRules';
import SimulationMonitorControl from '../SimulationMonitorControl';

const { Text } = Typography;

interface ArenaStandbyViewProps {
  selectedCompetition: string;
  currentTitle: string;
  compInfo: CompetitionInfo | null;
  currentEnteredMeta?: EnteredCompetition;
  formatDate: (val?: string) => string;
  clawbot?: SimulationClawbotStatus | null;
  testingClawbot: boolean;
  onTestClawbot: () => Promise<void>;
  diskFreeGB: string | number;
  healthReady?: boolean;
  onNavigateToKernels: () => void;
}

export const ArenaStandbyView: React.FC<ArenaStandbyViewProps> = ({
  selectedCompetition,
  currentTitle,
  compInfo,
  currentEnteredMeta,
  formatDate,
  clawbot,
  testingClawbot,
  onTestClawbot,
  diskFreeGB,
  healthReady = false,
  onNavigateToKernels,
}) => {
  const totalTeams = compInfo?.team_count ?? currentEnteredMeta?.team_count ?? 0;
  const { goldRank, silverRank, bronzeRank } = calculateMedalRanks(totalTeams);

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
      <Col xs={24} lg={15}>
        <Card
          className="dashboard-glow-card"
          style={{
            borderRadius: 14,
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.02)',
          }}
          styles={{ body: { padding: '20px 22px' } }}
        >
          {/* Competition Header Info */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <Space align="start" size={12}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: '#eff6ff', display: 'grid', placeItems: 'center', border: '1px solid #dbeafe', flexShrink: 0 }}>
                <Swords size={20} color="#2563eb" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: 17, color: '#0f172a' }}>
                    {currentTitle}
                  </span>
                  <Tag color="blue" style={{ fontWeight: 600, margin: 0 }}>
                    {compInfo?.category || currentEnteredMeta?.category || '竞赛'}
                  </Tag>
                  <Tag color="orange" style={{ fontWeight: 600, margin: 0 }}>
                    ⏳ 监控休眠中
                  </Tag>
                </div>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 3 }}>
                  比赛 ID：<code>{selectedCompetition}</code>
                </Text>
              </div>
            </Space>
          </div>

          {/* Competition Metadata Quick Cards */}
          <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
            <Col xs={24} sm={8}>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                  <Calendar size={13} color="#64748b" />
                  <span>截止时间</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
                  {formatDate(compInfo?.deadline || currentEnteredMeta?.deadline)}
                </div>
              </div>
            </Col>

            <Col xs={24} sm={8}>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                  <Users size={13} color="#64748b" />
                  <span>参赛队伍数</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
                  {totalTeams > 0 ? `${totalTeams.toLocaleString()} 支队伍` : '—'}
                </div>
              </div>
            </Col>

            <Col xs={24} sm={8}>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                  <Award size={13} color="#64748b" />
                  <span>奖金池 / 荣誉</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
                  {compInfo?.reward || currentEnteredMeta?.reward || '—'}
                </div>
              </div>
            </Col>
          </Row>

          {/* Official Medal Cutoffs (Pure Data, No Fluff) */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', border: '1px solid #e2e8f0', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#475569', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontWeight: 700, color: '#1e293b' }}>
                🏆 官方奖牌线席位切分 {totalTeams > 0 ? `(共 ${totalTeams.toLocaleString()} 支队伍)` : ''}
              </span>
            </div>
            <Row gutter={[8, 8]}>
              <Col xs={8}>
                <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#a16207', fontWeight: 600 }}>🥇 金牌区</div>
                  <div style={{ fontSize: 14, color: '#ca8a04', fontWeight: 800, marginTop: 2 }}>
                    Top {goldRank > 0 ? goldRank : '—'}
                  </div>
                </div>
              </Col>
              <Col xs={8}>
                <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 600 }}>🥈 银牌区</div>
                  <div style={{ fontSize: 14, color: '#0284c7', fontWeight: 800, marginTop: 2 }}>
                    Top {silverRank > 0 ? silverRank : '—'}
                  </div>
                </div>
              </Col>
              <Col xs={8}>
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>🥉 铜牌区</div>
                  <div style={{ fontSize: 14, color: '#d97706', fontWeight: 800, marginTop: 2 }}>
                    Top {bronzeRank > 0 ? bronzeRank : '—'}
                  </div>
                </div>
              </Col>
            </Row>
          </div>

          {/* Action & Standby Control Strip (Clean & Direct) */}
          <div
            style={{
              background: '#f8fafc',
              borderRadius: 10,
              padding: '12px 14px',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <Space size={8}>
              <Zap size={16} color="#d97706" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                  当前保持休眠（节约 API 额度）
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  提交后输入 Submission ID 即可开始追踪战力
                </div>
              </div>
            </Space>

            <Space size={8} wrap>
              <SimulationMonitorControl
                currentCompetition={selectedCompetition}
                buttonType="primary"
                buttonText="开启对战监控"
              />
              <Button
                icon={<LayoutDashboard size={14} />}
                onClick={onNavigateToKernels}
              >
                Kernel 广场
              </Button>
            </Space>
          </div>
        </Card>
      </Col>

      {/* Right: WeChat ClawBot Hub in Standby */}
      <Col xs={24} lg={9}>
        <ClawbotSidebarCard
          clawbot={clawbot}
          testingClawbot={testingClawbot}
          onTestClawbot={onTestClawbot}
          isStandby={true}
          selectedCompetition={selectedCompetition}
          diskFreeGB={diskFreeGB}
          healthReady={healthReady}
        />
      </Col>
    </Row>
  );
};

export default ArenaStandbyView;
