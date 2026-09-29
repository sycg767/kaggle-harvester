import React from 'react';
import { Button, Card, Col, Row, Space, Tag, Typography } from 'antd';
import { Award, Calendar, CheckCircle2, LayoutDashboard, Swords, Users } from 'lucide-react';
import type {
  CompetitionInfo,
  EnteredCompetition,
  SimulationClawbotStatus,
} from '../../types/api';
import ClawbotSidebarCard from './ClawbotSidebarCard';

const { Text, Paragraph } = Typography;

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
  const totalTeams = compInfo?.team_count ?? currentEnteredMeta?.team_count ?? 8991;
  const goldRank = Math.max(1, Math.min(10 + Math.ceil(totalTeams * 0.002), totalTeams));
  const silverRank = Math.max(goldRank + 1, Math.ceil(totalTeams * 0.05));
  const bronzeRank = Math.max(silverRank + 1, Math.ceil(totalTeams * 0.10));

  return (
    <Row gutter={[18, 18]} style={{ marginBottom: 22 }}>
      <Col xs={24} lg={15}>
        <Card
          className="dashboard-glow-card"
          style={{
            borderRadius: 14,
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.02)',
          }}
          styles={{ body: { padding: '24px 26px' } }}
        >
          {/* Competition Header Info */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <Space align="start" size={14}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: '#eff6ff', display: 'grid', placeItems: 'center', border: '1px solid #dbeafe' }}>
                <Swords size={22} color="#2563eb" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: 18, color: '#0f172a' }}>
                    {currentTitle}
                  </span>
                  <Tag color="blue" style={{ fontWeight: 700, margin: 0 }}>
                    {compInfo?.category || currentEnteredMeta?.category || '竞赛'}
                  </Tag>
                  <Tag color="orange" style={{ fontWeight: 600, margin: 0 }}>
                    ⏳ 待最终提交后开启监控
                  </Tag>
                </div>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                  比赛 ID：<code>{selectedCompetition}</code>
                </Text>
              </div>
            </Space>
          </div>

          {/* Competition Metadata Quick Cards */}
          <Row gutter={[12, 12]} style={{ marginBottom: 22 }}>
            <Col xs={24} sm={8}>
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Calendar size={14} color="#64748b" />
                  <span>截止时间</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                  {formatDate(compInfo?.deadline || currentEnteredMeta?.deadline)}
                </div>
              </div>
            </Col>

            <Col xs={24} sm={8}>
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Users size={14} color="#64748b" />
                  <span>参赛队伍数</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                  {compInfo?.team_count ?? currentEnteredMeta?.team_count ?? '—'} 支队伍
                </div>
              </div>
            </Col>

            <Col xs={24} sm={8}>
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Award size={14} color="#64748b" />
                  <span>奖金池 / 荣誉</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                  {compInfo?.reward || currentEnteredMeta?.reward || '—'}
                </div>
              </div>
            </Col>
          </Row>

          {/* Ready / Standby Guidance Box */}
          <div
            style={{
              background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
              borderRadius: 12,
              padding: '20px 22px',
              border: '1px solid #bbf7d0',
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <CheckCircle2 size={18} color="#16a34a" />
              <span style={{ fontWeight: 800, fontSize: 15, color: '#166534' }}>
                模拟天梯对抗监控已就绪（当前保持休眠）
              </span>
            </div>
            <Paragraph style={{ fontSize: 13, color: '#15803d', lineHeight: 1.6, marginBottom: 12 }}>
              您已将 <strong>{currentTitle}</strong> 选为主视角。按照您的规划，当前阶段不主动拉取天梯流水以节约 API 配额；
              <strong>等最后提交完全结束时</strong>，您只需点击右上角<strong>「对战监控」</strong>按钮输入您的 Agent Submission ID，系统将立即开始追踪 ELO 积分、战力安全垫并生成全赛程复盘走势。
            </Paragraph>

            <Space size={10} wrap>
              <Button
                type="primary"
                icon={<LayoutDashboard size={14} />}
                onClick={onNavigateToKernels}
              >
                前往 Kernel 广场探索该赛事代码
              </Button>
            </Space>
          </div>

          {/* Projected Medal Cutoffs Bracket */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', border: '1px solid #e2e8f0', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#64748b', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontWeight: 700, color: '#1e293b' }}>
                🏆 预估奖牌席位分界 (根据当前 {totalTeams.toLocaleString()} 支参赛队伍测算)
              </span>
              <Space size={14} wrap>
                <span style={{ color: '#ca8a04', fontWeight: 700 }}>
                  🥇 金牌区: Top {goldRank} 名
                </span>
                <span style={{ color: '#0284c7', fontWeight: 700 }}>
                  🥈 银牌区: Top {silverRank} 名
                </span>
                <span style={{ color: '#d97706', fontWeight: 700 }}>
                  🥉 铜牌区: Top {bronzeRank} 名
                </span>
              </Space>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              待您在 Kaggle 完成最终冲刺提交并填入 Submission ID 后，天梯监控模块将自动对照最新排行榜排位与 ELO 积分，实时计算您与金/银/铜牌线的安全垫差值。
            </div>
          </div>

          {/* Standby Feature Slots preview */}
          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 10 }}>
              开启监控后将自动激活的能力：
            </div>
            <Row gutter={[10, 10]}>
              <Col xs={24} sm={8}>
                <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, fontSize: 12, color: '#64748b' }}>
                  ⚡ <strong>多 Agent 胜率矩阵</strong>：对比不同提交版本对抗效果
                </div>
              </Col>
              <Col xs={24} sm={8}>
                <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, fontSize: 12, color: '#64748b' }}>
                  📈 <strong>全赛程 ELO 曲线</strong>：记录每场匹配胜负与分值波动
                </div>
              </Col>
              <Col xs={24} sm={8}>
                <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, fontSize: 12, color: '#64748b' }}>
                  🛡️ <strong>奖牌安全垫预警</strong>：实时计算金/银/铜切分水线
                </div>
              </Col>
            </Row>
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
