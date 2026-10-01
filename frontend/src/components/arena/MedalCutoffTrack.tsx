import React from 'react';
import { Card, Tooltip } from 'antd';
import { Trophy, Medal, Award } from 'lucide-react';
import type { SimulationAgentStats, SimulationMedalThresholds } from '../../types/api';
import type { AgentMetaItem } from './agentMeta';

interface MedalCutoffTrackProps {
  thresholds?: SimulationMedalThresholds;
  agents: SimulationAgentStats[];
  totalTeams?: number;
  isFinished: boolean;
  getAgentMeta: (ag: SimulationAgentStats, idx: number) => AgentMetaItem;
}

export const MedalCutoffTrack: React.FC<MedalCutoffTrackProps> = ({
  thresholds,
  agents,
  totalTeams,
  isFinished,
  getAgentMeta,
}) => {
  const goldCutoff = thresholds?.gold_cutoff_score;
  const silverCutoff = thresholds?.silver_cutoff_score;
  const bronzeCutoff = thresholds?.bronze_cutoff_score;
  if (goldCutoff == null || silverCutoff == null || bronzeCutoff == null) {
    return <Card className="arena-panel arena-cutoff-panel">奖牌线数据不完整，暂不绘制区间；不会使用默认分数代替。</Card>;
  }
  const goldRank = thresholds?.gold_cutoff_rank ?? '未知';
  const silverRank = thresholds?.silver_cutoff_rank ?? '未知';
  const bronzeRank = thresholds?.bronze_cutoff_rank ?? '未知';

  const allScores: number[] = [
    bronzeCutoff,
    silverCutoff,
    goldCutoff,
    ...agents.map((a) => a.score ?? a.public_score).filter((s): s is number => s !== undefined && s !== null),
  ];
  const minScore = Math.floor(Math.min(...allScores) - 40);
  const maxScore = Math.ceil(Math.max(...allScores) + 40);
  const scoreSpan = Math.max(1, maxScore - minScore);

  const getPct = (score: number) => Math.max(0, Math.min(100, ((score - minScore) / scoreSpan) * 100));
  const getPinPct = (score: number) => Math.max(7, Math.min(93, ((score - minScore) / scoreSpan) * 100));

  const posBronze = getPct(bronzeCutoff);
  const posSilver = getPct(silverCutoff);
  const posGold = getPct(goldCutoff);

  return (
    <Card className="arena-panel arena-cutoff-panel">
      {/* Header Info */}
      <div className="arena-cutoff-header">
        <div className="arena-cutoff-title-group">
          <Award size={16} color="#007aff" />
          <h3 className="arena-cutoff-title">
            奖牌线切分 (总计 {totalTeams?.toLocaleString() ?? '未知'} 支参赛队{isFinished ? ' · 截止后快照' : ''})
          </h3>
        </div>
        <div className="arena-cutoff-legends">
          <Tooltip title={`金牌线 (第 ${goldRank} 名及以上)`}>
            <span className="arena-cutoff-legend gold">
              <Trophy size={13} color="#ca8a04" />
              <span className="arena-cutoff-main-text">金牌线: {goldCutoff.toFixed(1)}分</span>
              <span className="arena-cutoff-sub">(第{goldRank}名)</span>
            </span>
          </Tooltip>
          <Tooltip title={`银牌线 (第 ${silverRank} 名及以上)`}>
            <span className="arena-cutoff-legend silver">
              <Medal size={13} color="#0284c7" />
              <span className="arena-cutoff-main-text">银牌线: {silverCutoff.toFixed(1)}分</span>
              <span className="arena-cutoff-sub">(第{silverRank}名)</span>
            </span>
          </Tooltip>
          <Tooltip title={`铜牌线 (第 ${bronzeRank} 名及以上)`}>
            <span className="arena-cutoff-legend bronze">
              <Award size={13} color="#d97706" />
              <span className="arena-cutoff-main-text">铜牌线: {bronzeCutoff.toFixed(1)}分</span>
              <span className="arena-cutoff-sub">(第{bronzeRank}名)</span>
            </span>
          </Tooltip>
        </div>
      </div>

      {/* Visual Multi-Segment Bar Container */}
      <div className="arena-cutoff-track-wrap">
        {/* Dynamic Agent Pin Markers */}
        {agents.map((ag, idx) => {
          const score = ag.score ?? ag.public_score;
          if (score === undefined || score === null) return null;
          const pos = getPinPct(score);
          const meta = getAgentMeta(ag, idx);
          const pColor = meta.accent || '#007aff';
          const tierLabel = ag.medal_tier === 'gold' ? '金牌区' : ag.medal_tier === 'silver' ? '银牌区' : ag.medal_tier === 'bronze' ? '铜牌区' : '奖牌状态未知';

          return (
            <Tooltip
              key={ag.submission_id || idx}
              title={`${meta.name}: ${score.toFixed(1)}分 (${ag.rank ? `第${ag.rank}名 · ` : ''}${tierLabel})`}
            >
              <div
                className="arena-cutoff-pin"
                style={{
                  left: `${pos}%`,
                  zIndex: 3 + idx,
                }}
              >
                <div
                  className="arena-cutoff-pin-badge"
                  style={{
                    background: pColor,
                    boxShadow: `0 2px 6px ${pColor}44`,
                  }}
                >
                  {meta.shortName}: {score.toFixed(1)}
                </div>
                <div
                  className="arena-cutoff-pin-arrow"
                  style={{
                    borderTopColor: pColor,
                  }}
                />
              </div>
            </Tooltip>
          );
        })}

        {/* Multi-Segment Track */}
        <div className="arena-cutoff-bar">
          {/* Below Bronze Segment */}
          <div
            className="arena-cutoff-segment unranked"
            style={{ width: `${posBronze}%` }}
          />
          {/* Bronze Zone Segment */}
          <div
            className="arena-cutoff-segment bronze-zone"
            style={{ width: `${Math.max(0, posSilver - posBronze)}%` }}
          />
          {/* Silver Zone Segment */}
          <div
            className="arena-cutoff-segment silver-zone"
            style={{ width: `${Math.max(0, posGold - posSilver)}%` }}
          />
          {/* Gold Zone Segment */}
          <div
            className="arena-cutoff-segment gold-zone"
            style={{ width: `${Math.max(0, 100 - posGold)}%` }}
          />
        </div>

        {/* Vertical Cutoff Threshold Markers & Labels */}
        <div
          className="arena-cutoff-threshold bronze"
          style={{ left: `${posBronze}%` }}
        >
          <div className="arena-cutoff-tick" />
          <span className="arena-cutoff-val">
            <Award size={11} style={{ marginRight: 2 }} />
            {bronzeCutoff.toFixed(1)}
          </span>
        </div>

        <div
          className="arena-cutoff-threshold silver"
          style={{ left: `${posSilver}%` }}
        >
          <div className="arena-cutoff-tick" />
          <span className="arena-cutoff-val">
            <Medal size={11} style={{ marginRight: 2 }} />
            {silverCutoff.toFixed(1)}
          </span>
        </div>

        <div
          className="arena-cutoff-threshold gold"
          style={{ left: `${posGold}%` }}
        >
          <div className="arena-cutoff-tick" />
          <span className="arena-cutoff-val">
            <Trophy size={11} style={{ marginRight: 2 }} />
            {goldCutoff.toFixed(1)}
          </span>
        </div>
      </div>
    </Card>
  );
};

export default MedalCutoffTrack;
