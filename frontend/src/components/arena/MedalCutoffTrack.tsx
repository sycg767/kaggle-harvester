import React from 'react';
import { Space, Tooltip } from 'antd';
import type { SimulationAgentStats, SimulationMedalThresholds } from '../../types/api';

interface AgentMetaItem {
  name: string;
  tagColor: string;
  bg: string;
  borderColor: string;
}

import { calculateMedalRanks } from './medalRules';

interface MedalCutoffTrackProps {
  thresholds?: SimulationMedalThresholds;
  agents: SimulationAgentStats[];
  totalTeams: number;
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
  const goldCutoff = thresholds?.gold_cutoff_score || 950;
  const silverCutoff = thresholds?.silver_cutoff_score || 890;
  const bronzeCutoff = thresholds?.bronze_cutoff_score || 839;

  const fallbackRanks = calculateMedalRanks(totalTeams, thresholds?.bronze_percentile || 0.10);
  const goldRank = thresholds?.gold_cutoff_rank || fallbackRanks.goldRank;
  const silverRank = thresholds?.silver_cutoff_rank || fallbackRanks.silverRank;
  const bronzeRank = thresholds?.bronze_cutoff_rank || fallbackRanks.bronzeRank;

  const goldDesc = totalTeams >= 1000 ? 'Top 10 + 0.2%' : totalTeams >= 100 ? 'Top 10' : 'Top 10%';
  const silverDesc = totalTeams >= 1000 ? 'Top 5%' : totalTeams >= 250 ? 'Top 50' : 'Top 20%';
  const bronzeDesc = totalTeams >= 1000
    ? `Top ${Math.round((thresholds?.bronze_percentile || 0.10) * 100)}%`
    : totalTeams >= 250
      ? 'Top 100'
      : 'Top 40%';

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

  const posBronze = getPct(bronzeCutoff);
  const posSilver = getPct(silverCutoff);
  const posGold = getPct(goldCutoff);

  return (
    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', border: '1px solid #e2e8f0', marginBottom: 16 }}>
      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#64748b', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontWeight: 700, color: '#1e293b' }}>
          🏆 奖牌线切分 (总计 {totalTeams} 支参赛队{isFinished ? ' · 终榜线' : ''})
        </span>
        <Space size={14} wrap>
          <Tooltip title={`${goldDesc} 队伍 (第 ${goldRank} 名及以上)`}>
            <span style={{ color: '#ca8a04', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              🥇 金牌线: {goldCutoff.toFixed(1)}分 <span style={{ fontSize: 11, color: '#a16207' }}>({goldDesc} · 第{goldRank}名)</span>
            </span>
          </Tooltip>
          <Tooltip title={`${silverDesc} 队伍 (第 ${silverRank} 名及以上)`}>
            <span style={{ color: '#0284c7', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              🥈 银牌线: {silverCutoff.toFixed(1)}分 <span style={{ fontSize: 11, color: '#0369a1' }}>({silverDesc} · 第{silverRank}名)</span>
            </span>
          </Tooltip>
          <Tooltip title={`${bronzeDesc} 队伍 (第 ${bronzeRank} 名及以上)`}>
            <span style={{ color: '#d97706', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              🥉 铜牌线: {bronzeCutoff.toFixed(1)}分 <span style={{ fontSize: 11, color: '#b45309' }}>({bronzeDesc} · 第{bronzeRank}名)</span>
            </span>
          </Tooltip>
        </Space>
      </div>

      {/* Visual Multi-Segment Bar Container */}
      <div style={{ position: 'relative', paddingTop: 26, paddingBottom: 22, margin: '0 8px' }}>
        {/* Dynamic Agent Pin Markers */}
        {agents.map((ag, idx) => {
          const score = ag.score ?? ag.public_score;
          if (score === undefined || score === null) return null;
          const pos = getPct(score);
          const meta = getAgentMeta(ag, idx);
          const pinColors = ['#2563eb', '#7c3aed', '#059669', '#d97706'];
          const pColor = pinColors[idx % pinColors.length];

          return (
            <Tooltip
              key={ag.submission_id || idx}
              title={`${meta.name}: ${score.toFixed(1)}分 (${ag.rank ? `第${ag.rank}名 · ` : ''}${ag.medal_tier === 'gold' ? '🥇金牌区' : ag.medal_tier === 'silver' ? '🥈银牌区' : ag.medal_tier === 'bronze' ? '🥉铜牌区' : '暂无奖牌'})`}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: `${pos}%`,
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  cursor: 'pointer',
                  zIndex: 3 + idx,
                }}
              >
                <div
                  style={{
                    background: pColor,
                    color: '#ffffff',
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '1px 5px',
                    borderRadius: 4,
                    boxShadow: `0 1px 4px ${pColor}66`,
                    whiteSpace: 'nowrap',
                    lineHeight: '14px',
                  }}
                >
                  {meta.name.replace('Agent ', '')}: {score.toFixed(1)}
                </div>
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: '4px solid transparent',
                    borderRight: '4px solid transparent',
                    borderTop: `5px solid ${pColor}`,
                  }}
                />
              </div>
            </Tooltip>
          );
        })}

        {/* Multi-Segment Track */}
        <div
          style={{
            height: 12,
            borderRadius: 6,
            display: 'flex',
            overflow: 'hidden',
            background: '#e2e8f0',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
            position: 'relative',
          }}
        >
          {/* Below Bronze Segment */}
          <div
            style={{
              width: `${posBronze}%`,
              background: '#cbd5e1',
              height: '100%',
            }}
          />
          {/* Bronze Zone Segment */}
          <div
            style={{
              width: `${Math.max(0, posSilver - posBronze)}%`,
              background: 'linear-gradient(90deg, #fdba74, #fb923c)',
              height: '100%',
            }}
          />
          {/* Silver Zone Segment */}
          <div
            style={{
              width: `${Math.max(0, posGold - posSilver)}%`,
              background: 'linear-gradient(90deg, #7dd3fc, #38bdf8)',
              height: '100%',
            }}
          />
          {/* Gold Zone Segment */}
          <div
            style={{
              width: `${Math.max(0, 100 - posGold)}%`,
              background: 'linear-gradient(90deg, #fde047, #eab308)',
              height: '100%',
            }}
          />
        </div>

        {/* Vertical Cutoff Threshold Markers & Labels */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: `${posBronze}%`,
            transform: 'translateX(-50%)',
            fontSize: 10,
            fontWeight: 700,
            color: '#b45309',
            whiteSpace: 'nowrap',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div style={{ width: 1, height: 6, background: '#b45309', marginBottom: 2 }} />
          <span>🥉 {bronzeCutoff.toFixed(1)}</span>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: `${posSilver}%`,
            transform: 'translateX(-50%)',
            fontSize: 10,
            fontWeight: 700,
            color: '#0369a1',
            whiteSpace: 'nowrap',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div style={{ width: 1, height: 6, background: '#0369a1', marginBottom: 2 }} />
          <span>🥈 {silverCutoff.toFixed(1)}</span>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: `${posGold}%`,
            transform: 'translateX(-50%)',
            fontSize: 10,
            fontWeight: 700,
            color: '#a16207',
            whiteSpace: 'nowrap',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div style={{ width: 1, height: 6, background: '#a16207', marginBottom: 2 }} />
          <span>🥇 {goldCutoff.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
};

export default MedalCutoffTrack;
