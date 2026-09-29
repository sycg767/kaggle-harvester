import React from 'react';
import { Row, Col, Tag } from 'antd';
import { Trophy } from 'lucide-react';
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
    <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
      {agents.length === 0 ? (
        <Col span={24}>
          <div
            style={{
              padding: '24px 16px',
              background: '#f8fafc',
              borderRadius: 10,
              textAlign: 'center',
              color: '#94a3b8',
            }}
          >
            当前比赛暂无监控的 Agent 提交记录，点击右上角「模拟对战监控」可添加追踪选手
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
              ? '#16a34a'
              : ep?.result === 'loss'
              ? '#e11d48'
              : '#64748b';
          const delta =
            ep?.score_delta !== undefined
              ? ep.score_delta >= 0
                ? `+${ep.score_delta.toFixed(1)}`
                : ep.score_delta.toFixed(1)
              : '';
          const colSpan = agents.length === 1 ? 24 : 12;

          return (
            <Col xs={24} sm={colSpan} key={agent.submission_id || index}>
              <div
                style={{
                  background: isAboveBronze
                    ? meta.bg
                    : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                  border: isAboveBronze
                    ? `1px solid ${meta.borderColor}`
                    : '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '14px 16px',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <Tag color={meta.tagColor} style={{ fontWeight: 700, margin: 0 }}>
                      {meta.name} {agent.submission_id ? `(#${agent.submission_id})` : ''}
                    </Tag>
                    {agent.medal_tier === 'gold' ? (
                      <Tag color="gold" icon={<Trophy size={11} style={{ marginRight: 2 }} />}>
                        🥇 金牌区
                      </Tag>
                    ) : agent.medal_tier === 'silver' ? (
                      <Tag color="cyan" icon={<Trophy size={11} style={{ marginRight: 2 }} />}>
                        🥈 银牌区
                      </Tag>
                    ) : isAboveBronze ? (
                      <Tag color="orange" icon={<Trophy size={11} style={{ marginRight: 2 }} />}>
                        🥉 铜牌线内
                      </Tag>
                    ) : gap !== undefined && gap !== null ? (
                      <Tag color="default">距铜牌 {gap.toFixed(1)}分</Tag>
                    ) : (
                      <Tag color="default">未入围</Tag>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span
                      style={{
                        fontSize: 26,
                        fontWeight: 900,
                        color: isAboveBronze ? '#166534' : '#334155',
                      }}
                    >
                      {formatScore(scoreVal)}
                    </span>
                    <span style={{ fontSize: 12, color: isAboveBronze ? '#15803d' : '#64748b' }}>
                      分 ({agent.rank ? `第 ${agent.rank} 名` : '未上榜'})
                    </span>
                  </div>
                </div>

                <div style={{ marginTop: 8 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: isAboveBronze ? '#166534' : '#475569',
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                      flexWrap: 'wrap',
                      gap: 4,
                    }}
                  >
                    <span>
                      胜率: {agent.win_rate !== undefined ? agent.win_rate.toFixed(1) : '—'}% (
                      {agent.wins ?? 0}胜/{agent.losses ?? 0}负)
                    </span>
                    {(() => {
                      const score = agent.score ?? agent.public_score ?? 0;
                      const tier = agent.medal_tier || 'none';
                      if (isFinished) {
                        if (tier === 'gold')
                          return (
                            <span style={{ fontWeight: 700, color: '#ca8a04' }}>
                              🥇 终榜锁定: 金牌
                            </span>
                          );
                        if (tier === 'silver')
                          return (
                            <span style={{ fontWeight: 700, color: '#0284c7' }}>
                              🥈 终榜锁定: 银牌
                            </span>
                          );
                        if (tier === 'bronze')
                          return (
                            <span style={{ fontWeight: 700, color: '#16a34a' }}>
                              🥉 终榜锁定: 铜牌
                            </span>
                          );
                      }
                      if (tier === 'gold') {
                        const c =
                          agent.tier_cushion_score ??
                          (thresholds?.gold_cutoff_score
                            ? score - thresholds.gold_cutoff_score
                            : 0);
                        return (
                          <span style={{ fontWeight: 700, color: '#ca8a04' }}>
                            金牌安全垫: +{c.toFixed(1)}分
                          </span>
                        );
                      }
                      if (tier === 'silver') {
                        const c =
                          agent.tier_cushion_score ??
                          (thresholds?.silver_cutoff_score
                            ? score - thresholds.silver_cutoff_score
                            : 0);
                        return (
                          <span style={{ fontWeight: 700, color: '#0284c7' }}>
                            银牌安全垫: +{c.toFixed(1)}分
                          </span>
                        );
                      }
                      if (tier === 'bronze') {
                        const c =
                          agent.tier_cushion_score ??
                          agent.bronze_gap_score ??
                          (thresholds?.bronze_cutoff_score
                            ? score - thresholds.bronze_cutoff_score
                            : 0);
                        return (
                          <span style={{ fontWeight: 700, color: '#16a34a' }}>
                            铜牌安全垫: +{c.toFixed(1)}分
                          </span>
                        );
                      }
                      const gapVal =
                        agent.bronze_gap_score ??
                        (thresholds?.bronze_cutoff_score
                          ? score - thresholds.bronze_cutoff_score
                          : null);
                      if (gapVal !== null && gapVal !== undefined) {
                        return gapVal >= 0 ? (
                          <span style={{ fontWeight: 700, color: '#16a34a' }}>
                            铜牌安全垫: +{gapVal.toFixed(1)}分
                          </span>
                        ) : (
                          <span style={{ fontWeight: 700, color: '#e11d48' }}>
                            距铜牌: {gapVal.toFixed(1)}分
                          </span>
                        );
                      }
                      return <span style={{ color: '#94a3b8' }}>安全垫: —</span>;
                    })()}
                  </div>
                  <div
                    style={{
                      borderTop: isAboveBronze
                        ? '1px solid rgba(22, 101, 52, 0.1)'
                        : '1px solid #e2e8f0',
                      paddingTop: 4,
                    }}
                  >
                    {ep ? (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                        {isFinished ? '封榜收官战: ' : '最新: '}vs{' '}
                        {opp.length > 12 ? `${opp.slice(0, 12)}..` : opp}{' '}
                        <span style={{ color: resColor }}>
                          {res} {delta}
                        </span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>暂无近期对局记录</span>
                    )}
                  </div>
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
