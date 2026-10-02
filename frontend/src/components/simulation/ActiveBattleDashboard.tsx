import React, { useMemo } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  EditOutlined,
  InfoCircleOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { Flame, Swords } from 'lucide-react';
import type {
  SimulationAgentStats,
  SimulationEpisodePageResponse,
  SimulationMedalThresholds,
} from '../../types/api';
import { getMedalTag, getShortAgentName } from './utils';
import { getSideEpisodeColumns } from './sideEpisodeColumns';

const { Text } = Typography;

interface ActiveBattleDashboardProps {
  thresholds?: SimulationMedalThresholds;
  agents: SimulationAgentStats[];
  getAgentMedal: (agent: SimulationAgentStats) => string | undefined;
  openEditAliasModal: (subId: number, currentAlias: string) => void;
  getRatedEpisodeCount: (agent?: SimulationAgentStats) => number;
  totalTrackedCount: number;
  episodePages: Record<number, SimulationEpisodePageResponse>;
  episodeLoading: Record<number, boolean>;
  fetchEpisodePage: (submissionId: number, page?: number, pageSize?: number) => Promise<void>;
}

export const ActiveBattleDashboard: React.FC<ActiveBattleDashboardProps> = ({
  thresholds,
  agents,
  getAgentMedal,
  openEditAliasModal,
  getRatedEpisodeCount,
  totalTrackedCount,
  episodePages,
  episodeLoading,
  fetchEpisodePage,
}) => {
  const sideEpisodeColumns = useMemo(() => getSideEpisodeColumns(), []);

  return (
    <>
      {/* Medal Thresholds Banner: Ordered Gold -> Silver -> Bronze */}
      {thresholds && (
        <Card
          size="small"
          className="sim-banner-card"
          styles={{ body: { padding: '12px 18px' } }}
        >
          <Row gutter={[12, 12]} align="middle">
            <Col xs={12} sm={6}>
              <Statistic
                title={<span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>天梯总参赛队伍</span>}
                value={thresholds.total_teams}
                suffix={<span style={{ fontSize: 12, color: '#94a3b8' }}>队</span>}
                valueStyle={{ fontWeight: 700, fontSize: 18 }}
              />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic
                title={
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#ca8a04', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <TrophyOutlined style={{ fontSize: 13, color: '#ca8a04' }} /> 金牌线
                  </span>
                }
                value={thresholds.gold_cutoff_score ?? '—'}
                suffix={
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    (第 {thresholds.gold_cutoff_rank} 名)
                  </span>
                }
                valueStyle={{ color: '#ca8a04', fontWeight: 800, fontSize: 18 }}
              />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic
                title={
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <TrophyOutlined style={{ fontSize: 13, color: '#64748b' }} /> 银牌线
                  </span>
                }
                value={thresholds.silver_cutoff_score ?? '—'}
                suffix={
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    (第 {thresholds.silver_cutoff_rank} 名)
                  </span>
                }
                valueStyle={{ color: '#475569', fontWeight: 800, fontSize: 18 }}
              />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic
                title={
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <TrophyOutlined style={{ fontSize: 13, color: '#d97706' }} /> 铜牌线
                  </span>
                }
                value={thresholds.bronze_cutoff_score ?? '—'}
                suffix={
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    (第 {thresholds.bronze_cutoff_rank} 名)
                  </span>
                }
                valueStyle={{ color: '#d97706', fontWeight: 800, fontSize: 18 }}
              />
            </Col>
          </Row>
        </Card>
      )}

      {/* Dual Agent Overview Cards */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <Flame size={16} color="#f97316" />
          <Text strong style={{ fontSize: 14 }}>已跟踪 {agents.length} 个提交的最近战况</Text>
        </div>

        {agents.length === 0 ? (
          <Empty description="暂无代理数据，请点击右上角「立即刷新」拉取数据。" />
        ) : (
          <Row gutter={[16, 16]}>
            {agents.map((agent, idx) => {
              const shortName = getShortAgentName(agent, idx);
              const medalTier = getAgentMedal(agent);
              const scoreVal = agent.score ?? agent.public_score;

              return (
                <Col xs={24} md={12} key={agent.submission_id}>
                  <Card
                    className="sim-agent-card"
                    styles={{ body: { padding: 18 } }}
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <Space size={8} align="center" wrap style={{ minWidth: 0 }}>
                          <Tag color={idx === 0 ? 'blue' : 'purple'} style={{ margin: 0, fontWeight: 700 }}>
                            Agent #{idx + 1}
                          </Tag>
                          <span style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                            {shortName}
                          </span>
                          <Tooltip title={`修改自定义别名（如 p32, p46，当前：${shortName}）`}>
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined style={{ color: '#64748b', fontSize: 13 }} />}
                              onClick={() => openEditAliasModal(agent.submission_id, shortName)}
                              style={{ width: 22, height: 22, padding: 0 }}
                              aria-label="修改别名"
                            />
                          </Tooltip>
                          {(agent.description || agent.file_name) && (
                            <Tooltip title={agent.description || agent.file_name}>
                              <InfoCircleOutlined style={{ color: '#94a3b8', fontSize: 13, cursor: 'pointer' }} />
                            </Tooltip>
                          )}
                        </Space>
                        {getMedalTag(medalTier)}
                      </div>
                    }
                  >
                    {/* Score & Rank banner - 2 Column Clean Card Layout */}
                    <Row gutter={12}>
                      <Col span={12}>
                        <div className="sim-score-box">
                          <span className="sim-score-title">当前天梯积分</span>
                          <span className="sim-score-value">
                            {scoreVal !== undefined && scoreVal !== null ? Number(scoreVal).toFixed(1) : '—'}
                          </span>
                        </div>
                      </Col>

                      <Col span={12}>
                        <div className="sim-rank-box">
                          <span className="sim-rank-title">当前排行榜名次</span>
                          <span className="sim-rank-value">
                            {agent.rank ? `第 ${agent.rank} 名` : '—'}
                          </span>
                        </div>
                      </Col>
                    </Row>

                    {/* Dynamic Medal Tier Cushion Banner */}
                    {(() => {
                      const sc = scoreVal != null ? Number(scoreVal) : null;
                      const difference = (cutoff?: number | null) => sc != null && cutoff != null ? sc - cutoff : null;
                      const formatGap = (value?: number | null, plus = false) => value == null ? '未知（缺少积分或奖牌线）' : `${plus && value >= 0 ? '+' : ''}${value.toFixed(1)} 分`;
                      let cushionTitle = '⚠️ 距离铜牌线差距';
                      let cushionVal = formatGap(agent.bronze_gap_score ?? difference(thresholds?.bronze_cutoff_score));
                      let nextGapText: string | null = null;
                      let bannerClass = 'sim-cushion-banner-danger';

                      if (medalTier === 'gold') {
                        cushionTitle = '金牌安全垫 (高于金牌线)';
                        const c = agent.tier_cushion_score ?? difference(thresholds?.gold_cutoff_score);
                        cushionVal = formatGap(c, true);
                        bannerClass = 'sim-cushion-banner-gold';
                      } else if (medalTier === 'silver') {
                        cushionTitle = '银牌安全垫 (高于银牌线)';
                        const c = agent.tier_cushion_score ?? difference(thresholds?.silver_cutoff_score);
                        cushionVal = formatGap(c, true);
                        bannerClass = 'sim-cushion-banner-silver';
                        const nextGap = agent.next_tier_gap_score ?? (sc != null && thresholds?.gold_cutoff_score != null ? thresholds.gold_cutoff_score - sc : null);
                        if (nextGap !== null && nextGap !== undefined) {
                          nextGapText = `距金牌线 ${nextGap.toFixed(1)} 分`;
                        }
                      } else if (medalTier === 'bronze') {
                        cushionTitle = '铜牌安全垫 (高于铜牌线)';
                        const c = agent.tier_cushion_score ?? agent.bronze_gap_score ?? difference(thresholds?.bronze_cutoff_score);
                        cushionVal = formatGap(c, true);
                        bannerClass = 'sim-cushion-banner-bronze';
                        const nextGap = agent.next_tier_gap_score ?? (sc != null && thresholds?.silver_cutoff_score != null ? thresholds.silver_cutoff_score - sc : null);
                        if (nextGap !== null && nextGap !== undefined) {
                          nextGapText = `距银牌线 ${nextGap.toFixed(1)} 分`;
                        }
                      } else {
                        cushionTitle = '距离铜牌线差距';
                        const gap = agent.bronze_gap_score ?? difference(thresholds?.bronze_cutoff_score);
                        cushionVal = formatGap(gap);
                        bannerClass = 'sim-cushion-banner-danger';
                      }

                      return (
                        <div className={bannerClass}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span>{cushionTitle}</span>
                            {nextGapText && (
                              <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.85, background: 'rgba(0,0,0,0.05)', padding: '1px 6px', borderRadius: 4 }}>
                                {nextGapText}
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 800 }}>
                            {cushionVal}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Win Rate Progress & Stats */}
                    <div className="sim-stats-section">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 12, color: '#334155' }}>
                          胜率 ({agent.win_rate.toFixed(1)}%)
                        </span>
                        <Space size={4} wrap>
                          <Tag color="success" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>{agent.wins} 胜</Tag>
                          <Tag color="error" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>{agent.losses} 负</Tag>
                          {agent.ties > 0 && <Tag style={{ margin: 0, fontSize: 11 }}>{agent.ties} 平</Tag>}
                          <Text type="secondary" style={{ fontSize: 11, marginLeft: 2 }}>(共 {getRatedEpisodeCount(agent)} 局)</Text>
                        </Space>
                      </div>
                      <Progress
                        percent={agent.win_rate}
                        strokeColor={agent.win_rate >= 50 ? '#10b981' : '#f59e0b'}
                        showInfo={false}
                        size={['100%', 6]}
                      />
                    </div>

                    {/* Card Footer Meta */}
                    <div className="sim-footer-meta">
                      <span>提交 ID: <code style={{ fontFamily: 'var(--font-mono)', color: '#475569', fontWeight: 600 }}>#{agent.submission_id}</code></span>
                      {agent.alias && (
                        <span>别名: <strong style={{ color: '#0284c7' }}>{agent.alias}</strong></span>
                      )}
                      <span>队伍: <strong style={{ color: '#1e293b' }}>{agent.team_name || '我方团队'}</strong></span>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </div>

      {/* Match Stream Section: Split into Left and Right Columns */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Swords size={16} color="#3b82f6" />
            <Text strong style={{ fontSize: 14 }}>最新对局流水 (点击对局 ID 可观看回放)</Text>
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            共追踪 {totalTrackedCount} 场对战记录
          </Text>
        </div>

        <Row gutter={[16, 16]}>
          {agents.map((agent, index) => {
            const page = episodePages[agent.submission_id];
            return (
              <Col xs={24} lg={12} key={agent.submission_id}>
                <Card size="small" className="sim-agent-card" title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', whiteSpace: 'normal' }}>
                    <Tag color={index % 2 ? 'purple' : 'blue'}>Agent #{index + 1}</Tag>
                    <span style={{ overflowWrap: 'anywhere' }}>{getShortAgentName(agent, index)} 对局流水</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>共 {getRatedEpisodeCount(agent)} 局 ({agent.wins || 0}胜 {agent.losses || 0}负)</Text>
                  </div>
                }>
                  <Table columns={sideEpisodeColumns} dataSource={page?.episodes ?? []} rowKey="id"
                    size="small" scroll={{ x: 380 }} bordered
                    pagination={{
                      current: page ? Math.floor(page.offset / page.limit) + 1 : 1,
                      pageSize: page?.limit || 6, total: page?.total || 0,
                      showSizeChanger: false, size: 'small',
                      onChange: (number, size) => { void fetchEpisodePage(agent.submission_id, number, size); },
                    }} loading={Boolean(episodeLoading[agent.submission_id])}
                  />
                </Card>
              </Col>
            );
          })}
        </Row>
      </div>
    </>
  );
};

export default ActiveBattleDashboard;
