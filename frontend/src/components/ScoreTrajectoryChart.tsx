import React, { useMemo } from 'react';
import { Card, Empty } from 'antd';
import type {
  SimulationAgentStats,
  SimulationMedalThresholds,
} from '../api';
import {
  COLORS,
  labelForAgent,
  buildLegacyTrajectory,
  calculateYAxisTicks,
  integerTicks,
  TrajectorySvg,
  type ChartSeries,
} from './trajectory';

interface ScoreTrajectoryChartProps {
  agents: SimulationAgentStats[];
  thresholds?: SimulationMedalThresholds;
  competitionTitle?: string;
}

const ScoreTrajectoryChart: React.FC<ScoreTrajectoryChartProps> = ({
  agents,
  thresholds,
  competitionTitle,
}) => {
  const chart = useMemo(() => {
    const series = agents
      .map((agent, index) => {
        const systemCheckIds = new Set(
          (agent.recent_episodes || [])
            .filter((episode) => episode.is_system_check)
            .map((episode) => episode.id),
        );
        const trajectory = (agent.rating_trajectory?.length
          ? agent.rating_trajectory
          : buildLegacyTrajectory(agent)
        ).filter((point) => !point.is_system_check && !systemCheckIds.has(point.episode_id));
        const points = trajectory
          .slice()
          .sort((a, b) => a.game_number - b.game_number)
          .map((point, pointIndex) => ({
            x: point.game_number || pointIndex + 1,
            y: point.score,
            timestamp: point.timestamp,
            episodeId: point.episode_id,
            scoreDelta: point.score_delta,
            result: point.result,
          }));
        return {
          id: agent.submission_id,
          label: labelForAgent(agent, index),
          color: COLORS[index % COLORS.length],
          points,
          latest: points[points.length - 1],
          games: agent.total_episodes - (agent.system_checks || 0) || points[points.length - 1]?.x || 0,
        } satisfies ChartSeries;
      })
      .filter((item) => item.points.length > 0);

    const allPoints = series.flatMap((item) => item.points);
    const cutoffValues = [
      thresholds?.gold_cutoff_score,
      thresholds?.silver_cutoff_score,
      thresholds?.bronze_cutoff_score,
    ].filter((value): value is number => value !== undefined && value !== null);

    if (allPoints.length === 0) {
      return {
        series,
        xMin: 0,
        xMax: 10,
        yMin: 0,
        yMax: 100,
        xTicks: [0, 5, 10],
        yTicks: [0, 50, 100],
        goldCutoff: thresholds?.gold_cutoff_score,
        silverCutoff: thresholds?.silver_cutoff_score,
        bronzeCutoff: thresholds?.bronze_cutoff_score,
      };
    }

    const maxGames = Math.max(...allPoints.map((point) => point.x), ...series.map((item) => item.games));
    const minPointScore = Math.min(...allPoints.map((point) => point.y));
    const effectiveMinScore = Math.min(minPointScore, ...cutoffValues);
    const maxScore = Math.max(...allPoints.map((point) => point.y), ...cutoffValues);
    // 右侧预留外边距，确保即使各 Agent 局数不同，终点右侧分数标签也能完整横向展示
    const xPaddingRight = Math.max(16, Math.round(maxGames * 0.08));
    const yTickInfo = calculateYAxisTicks(effectiveMinScore - 10, maxScore + 15, 6);

    return {
      series,
      xMin: 0,
      xMax: Math.max(10, maxGames + xPaddingRight),
      yMin: yTickInfo.yMin,
      yMax: yTickInfo.yMax,
      xTicks: integerTicks(0, Math.max(10, maxGames + xPaddingRight), 5),
      yTicks: yTickInfo.ticks,
      goldCutoff: thresholds?.gold_cutoff_score,
      silverCutoff: thresholds?.silver_cutoff_score,
      bronzeCutoff: thresholds?.bronze_cutoff_score,
    };
  }, [agents, thresholds?.gold_cutoff_score, thresholds?.silver_cutoff_score, thresholds?.bronze_cutoff_score]);

  const hasData = chart.series.length > 0;

  return (
    <Card
      size="small"
      title=""
      style={{ marginTop: 16, borderRadius: 10, borderColor: '#e2e8f0' }}
      styles={{ body: { padding: '12px 16px 16px' } }}
    >
      {!hasData ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无轨迹数据"
          style={{ margin: '24px 0' }}
        />
      ) : (
        <TrajectorySvg
          chart={chart}
          title={competitionTitle ? `${competitionTitle} — Rating Progression` : undefined}
        />
      )}
    </Card>
  );
};

export default ScoreTrajectoryChart;
