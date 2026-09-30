import React from 'react';
import { Row, Col, Tag } from 'antd';
import { Trophy, Medal, Award } from 'lucide-react';
import type { SimulationAgentStats, SimulationMedalThresholds } from '../../types/api';
import { getAgentMeta as defaultGetAgentMeta, type AgentMetaItem } from './agentMeta';

interface AgentStatsGridProps {
  agents: SimulationAgentStats[];
  thresholds?: SimulationMedalThresholds;
  isFinished: boolean;
  getAgentMeta?: (agent: SimulationAgentStats, index: number) => AgentMetaItem;
}

export const AgentStatsGrid: React.FC<AgentStatsGridProps> = ({
  agents,
  thresholds,
  isFinished,
  getAgentMeta = defaultGetAgentMeta,
}) => {
  const formatScore = (val?: number | null) =>
    val !== undefined && val !== null ? val.toFixed(1) : '—';

  return (
    <Row gutter={[12, 12]} className="arena-agents-row">
      {agents.length === 0 ? (
        <Col span={24}>
          <div className="arena-empty-state">
            当前比赛暂无监控的 Agent 提交记录，点击右上角「天梯对战监控」可添加追踪选手
          </div>
        </Col>
      ) : (
        agents.map((agent, index) => {
          const meta = getAgentMeta(agent, index);
          const scoreVal = agent.score ?? agent.public_score;
          const gap = agent.bronze_gap_score;
          const isAboveBronze =
            (gap !== undefined && gap !== null && gap >= 0) ||
            agent.medal_tier === 'bronze' ||
            agent.medal_tier === 'silver' ||
            agent.medal_tier === 'gold';
          const ep = agent.recent_episodes?.[0];
          const opp = ep?.opponent_team_name || '';
          const res =
            ep?.result === 'win'
              ? '胜'
              : ep?.result === 'loss'
              ? '负'
              : ep?.result === 'tie'
              ? '平'
              : '';
          const resColor =
            ep?.result === 'win'
              ? '#34c759'
              : ep?.result === 'loss'
              ? '#ff3b30'
              : '#8e8e93';
          const delta =
            ep?.score_delta != null
              ? ep.score_delta >= 0
                ? `+${ep.score_delta.toFixed(1)}`
                : ep.score_delta.toFixed(1)
              : '';
          const colSpan = agents.length === 1 ? 24 : 12;

          return (
            <Col xs={24} sm={colSpan} key={agent.submission_id || index}>
              <div
                className="arena-agent-card"
                style={{
                  borderLeft: `4px solid ${meta.accent}`,
                }}
              >
                {/* Header row: Agent Name/ID + Medal Status */}
                <div className="arena-agent-card-header">
                  <div className="arena-agent-pill" style={{ color: meta.accent, background: meta.bg, borderColor: meta.borderColor }}>
                    <span className="arena-agent-dot" style={{ background: meta.accent }} />
                    <span className="arena-agent-name">{meta.name}</span>
                    {agent.submission_id && (
                      <span className="arena-agent-subid">#{agent.submission_id}</span>
                    )}
                  </div>

                  {agent.medal_tier === 'gold' ? (
                    <Tag color="gold" className="arena-tier-tag">
                      <Trophy size={12} color="#ca8a04" />
                      <span>金牌区</span>
                    </Tag>
                  ) : agent.medal_tier === 'silver' ? (
                    <Tag color="cyan" className="arena-tier-tag">
                      <Medal size={12} color="#0284c7" />
                      <span>银牌区</span>
                    </Tag>
                  ) : isAboveBronze ? (
                    <Tag color="orange" className="arena-tier-tag">
                      <Award size={12} color="#d97706" />
                      <span>铜牌线内</span>
                    </Tag>
                  ) : gap !== undefined && gap !== null ? (
                    <Tag color="default" className="arena-tier-tag">
                      距铜牌 {Math.abs(gap).toFixed(1)}分
                    </Tag>
                  ) : (
                    <Tag color="default" className="arena-tier-tag">奖牌状态未知</Tag>
                  )}
                </div>

                {/* Main Score & Rank row */}
                <div className="arena-agent-score-row">
                  <div className="arena-agent-score-value">
                    {formatScore(scoreVal)}
                  </div>
                  <div className="arena-agent-rank-badge">
                    {agent.rank ? `第 ${agent.rank} 名` : '排名未知'}
                  </div>
                </div>

                {/* Sub metrics strip */}
                <div className="arena-agent-metrics-row">
                  <div className="arena-agent-metric-item">
                    <span className="arena-metric-label">胜率:</span>
                    <span className="arena-metric-val">
                      {agent.win_rate != null ? agent.win_rate.toFixed(1) : '—'}%
                    </span>
                    <span className="arena-metric-sub">
                      ({agent.wins ?? '—'}胜/{agent.losses ?? '—'}负)
                    </span>
                  </div>

                  {!isFinished && (
                    <div className="arena-agent-metric-item">
                      {(() => {
                        const score = agent.score ?? agent.public_score;
                        if (score == null) return <span className="arena-metric-sub">安全垫: —</span>;
                        const tier = agent.medal_tier || 'none';
                        if (tier === 'gold') {
                          const c =
                            agent.tier_cushion_score ??
                            (thresholds?.gold_cutoff_score != null
                              ? score - thresholds.gold_cutoff_score
                              : null);
                          if (c == null) return <span className="arena-metric-sub">安全垫: —</span>;
                          return (
                            <span className="arena-cushion gold">
                              金牌安全垫: {c >= 0 ? '+' : ''}{c.toFixed(1)}分
                            </span>
                          );
                        }
                        if (tier === 'silver') {
                          const c =
                            agent.tier_cushion_score ??
                            (thresholds?.silver_cutoff_score != null
                              ? score - thresholds.silver_cutoff_score
                              : null);
                          if (c == null) return <span className="arena-metric-sub">安全垫: —</span>;
                          return (
                            <span className="arena-cushion silver">
                              银牌安全垫: {c >= 0 ? '+' : ''}{c.toFixed(1)}分
                            </span>
                          );
                        }
                        if (tier === 'bronze') {
                          const c =
                            agent.tier_cushion_score ??
                            agent.bronze_gap_score ??
                            (thresholds?.bronze_cutoff_score != null
                              ? score - thresholds.bronze_cutoff_score
                              : null);
                          if (c == null) return <span className="arena-metric-sub">安全垫: —</span>;
                          return (
                            <span className="arena-cushion bronze">
                              铜牌安全垫: {c >= 0 ? '+' : ''}{c.toFixed(1)}分
                            </span>
                          );
                        }
                        const gapVal =
                          agent.bronze_gap_score ??
                          (thresholds?.bronze_cutoff_score != null
                            ? score - thresholds.bronze_cutoff_score
                            : null);
                        if (gapVal !== null && gapVal !== undefined) {
                          return gapVal >= 0 ? (
                            <span className="arena-cushion bronze">
                              铜牌安全垫: +{gapVal.toFixed(1)}分
                            </span>
                          ) : (
                            <span className="arena-cushion danger">
                              距铜牌: {Math.abs(gapVal).toFixed(1)}分
                            </span>
                          );
                        }
                        return <span className="arena-metric-sub">安全垫: —</span>;
                      })()}
                    </div>
                  )}
                </div>

                {/* Recent episode strip */}
                <div className="arena-agent-recent-row">
                  {ep ? (
                    <span className="arena-recent-match">
                      <span className="arena-recent-prefix">最近记录:</span>
                      <span className="arena-recent-opp">vs {opp.length > 14 ? `${opp.slice(0, 14)}..` : opp}</span>
                      <span className="arena-recent-res" style={{ color: resColor }}>
                        {res} {delta}
                      </span>
                    </span>
                  ) : (
                    <span className="arena-metric-sub">暂无近期对局记录</span>
                  )}
                </div>
              </div>
            </Col>
          );
        })
      )}
    </Row>
  );
};

export default AgentStatsGrid;

