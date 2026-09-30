import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Spin,
} from 'antd';
import {
  api,
  type CompetitionInfo,
  type EnteredCompetition,
  type HealthStatus,
  type SimulationAgentStats,
  type SimulationMedalThresholds,
  type SimulationMonitorSnapshot,
} from '../api';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import { HARVESTER_EVENTS, dispatchCompetitionChanged } from '../events';
import { isCompetitionEnded, parseKaggleDeadline } from '../competitionOptions';
import ScoreTrajectoryChart from './ScoreTrajectoryChart';
import {
  ArenaHeader,
  AgentStatsGrid,
  MedalCutoffTrack,
  ArenaStandbyView,
  getAgentMeta,
} from './arena';

export const SimulationArena: React.FC = () => {
  const { message } = AntApp.useApp();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedCompetition, setSelectedCompetition] = useState<string>(() => {
    return localStorage.getItem('harvester.competition') || localStorage.getItem('harvester.arenaCompetition') || 'pokemon-tcg-ai-battle';
  });
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [simSnapshot, setSimSnapshot] = useState<SimulationMonitorSnapshot | null>(null);
  const [enteredComps, setEnteredComps] = useState<EnteredCompetition[]>([]);
  const [compInfo, setCompInfo] = useState<CompetitionInfo | null>(null);

  const handleCompetitionChange = (comp: string) => {
    setSelectedCompetition(comp);
    localStorage.setItem('harvester.competition', comp);
    localStorage.setItem('harvester.arenaCompetition', comp);
    dispatchCompetitionChanged(comp);
    void api.getCompetition(comp).then(setCompInfo).catch(() => setCompInfo(null));
  };

  useEffect(() => {
    const handleCompChange = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      const slug = customEvent.detail;
      if (slug && slug !== selectedCompetition) {
        setSelectedCompetition(slug);
        void api.getCompetition(slug).then(setCompInfo).catch(() => setCompInfo(null));
      }
    };
    window.addEventListener(HARVESTER_EVENTS.competitionChanged, handleCompChange);
    return () => window.removeEventListener(HARVESTER_EVENTS.competitionChanged, handleCompChange);
  }, [selectedCompetition]);

  const loadArenaData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);

    try {
      const [h, sim, enteredList] = await Promise.all([
        api.health().catch(() => null),
        api.getSimulationMonitor().catch(() => null),
        getEnteredCompetitions().catch(() => []),
      ]);

      if (h) setHealth(h);
      if (sim) setSimSnapshot(sim);
      if (enteredList && enteredList.length > 0) setEnteredComps(enteredList);

      const targetComp =
        selectedCompetition ||
        sim?.config?.competition ||
        h?.active_competition?.competition ||
        h?.default_competition ||
        '';
      if (targetComp && !selectedCompetition) {
        setSelectedCompetition(targetComp);
      }
      if (targetComp) {
        void api.getCompetition(targetComp).then(setCompInfo).catch(() => setCompInfo(null));
      }
    } catch (err: any) {
      if (!quiet) message.error(`加载模拟对战数据失败: ${err.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompetition, message]);

  useEffect(() => {
    void loadArenaData();
    const timer = setInterval(() => {
      void loadArenaData(true);
    }, 30000);
    return () => clearInterval(timer);
  }, [loadArenaData]);

  const currentEnteredMeta = enteredComps.find((c) => c.id === selectedCompetition);

  const isSimulationCompetition = useCallback((c: EnteredCompetition) => {
    if (c.is_simulation === true) return true;
    if (c.tags?.some((t) => t.toLowerCase().includes('simulation'))) return true;
    const id = c.id.toLowerCase();
    if (
      id.includes('strategy') ||
      id.includes('rsna') ||
      id.includes('biohub') ||
      id.includes('rogii') ||
      id.includes('security')
    ) {
      return false;
    }
    if (id === 'pokemon-tcg-ai-battle' || id === 'kaggriculture') return true;
    if (id.includes('simulation')) return true;
    return false;
  }, []);

  const simStatus = simSnapshot?.status;
  const configuredSimComp = simSnapshot?.config?.competition || simStatus?.competition || 'pokemon-tcg-ai-battle';

  // Clean competition options without result leaks or redundant tags
  const competitionOptions = useMemo(() => {
    const list: Array<{ value: string; label: string; tag?: string }> = [];
    const seen = new Set<string>();

    list.push({
      value: 'pokemon-tcg-ai-battle',
      label: '宝可梦 TCG (Pokemon TCG AI Battle)',
      tag: '已完赛',
    });
    seen.add('pokemon-tcg-ai-battle');

    const validSimComps = enteredComps.filter(isSimulationCompetition);
    for (const comp of validSimComps) {
      if (seen.has(comp.id)) continue;
      seen.add(comp.id);

      let displayName = comp.title && comp.title !== comp.id ? comp.title : comp.id;
      if (comp.id === 'kaggriculture') {
        displayName = 'Kaggriculture 农场经营对抗';
      }

      list.push({
        value: comp.id,
        label: displayName,
      });
    }

    if (configuredSimComp && !seen.has(configuredSimComp)) {
      list.push({
        value: configuredSimComp,
        label: `${configuredSimComp} (当前配置)`,
      });
    }

    return list;
  }, [enteredComps, configuredSimComp, isSimulationCompetition]);

  const hasSimData = useMemo(() => {
    if (selectedCompetition === 'pokemon-tcg-ai-battle') return true;
    if (configuredSimComp && selectedCompetition === configuredSimComp) {
      return (simStatus?.agents?.length ?? 0) > 0;
    }
    return false;
  }, [selectedCompetition, configuredSimComp, simStatus]);

  const isPokemon = selectedCompetition === 'pokemon-tcg-ai-battle';
  const isFinished = isPokemon || isCompetitionEnded(compInfo?.deadline);

  const agents: SimulationAgentStats[] = useMemo(() => {
    if (!hasSimData) return [];
    if (isPokemon && (!simStatus || simSnapshot?.config?.competition !== 'pokemon-tcg-ai-battle' || !simStatus.agents?.length)) {
      return [
        {
          submission_id: 55565346,
          alias: 'Agent p46',
          team_name: 'Agent p46',
          rank: 244,
          score: 951.0,
          public_score: 951.0,
          medal_tier: 'silver',
          tier_cushion_score: 27.0,
          wins: 731,
          losses: 598,
          ties: 2,
          total_episodes: 1331,
          system_checks: 1,
          win_rate: 55.0,
          rating_trajectory: [],
          recent_episodes: [
            {
              id: 1001,
              game_number: 1330,
              opponent_team_name: 'Jonathan Donham',
              result: 'loss',
              score_delta: -4.5,
              state: 'completed',
              agents: [],
              my_agent_index: 0,
              my_submission_id: 55565346,
              my_team_name: 'Agent p46',
              create_time: new Date().toISOString(),
            },
          ],
        },
        {
          submission_id: 55555162,
          alias: 'Agent p31',
          team_name: 'Agent p31',
          rank: 464,
          score: 897.2,
          public_score: 897.2,
          medal_tier: 'bronze',
          tier_cushion_score: 43.5,
          wins: 726,
          losses: 567,
          ties: 1,
          total_episodes: 1294,
          system_checks: 0,
          win_rate: 56.1,
          rating_trajectory: [],
          recent_episodes: [
            {
              id: 1002,
              game_number: 1294,
              opponent_team_name: 'Sans Mike',
              result: 'win',
              score_delta: 3.3,
              state: 'completed',
              agents: [],
              my_agent_index: 0,
              my_submission_id: 55555162,
              my_team_name: 'Agent p31',
              create_time: new Date().toISOString(),
            },
          ],
        },
      ];
    }
    return simStatus?.agents || [];
  }, [hasSimData, isPokemon, simSnapshot, simStatus]);

  const thresholds: SimulationMedalThresholds | undefined = useMemo(() => {
    if (isPokemon) {
      return {
        gold_cutoff_score: 1130.9,
        gold_cutoff_rank: 23,
        silver_cutoff_score: 924.0,
        silver_cutoff_rank: 340,
        bronze_cutoff_score: 853.7,
        bronze_cutoff_rank: 680,
        bronze_percentile: 0.10,
        total_teams: 6807,
      };
    }
    return simStatus?.thresholds || simStatus?.medal_thresholds;
  }, [isPokemon, simStatus]);

  const formatDate = (val?: string) => {
    if (!val) return '—';
    const d = parseKaggleDeadline(val) || new Date(val);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const currentTitle = compInfo?.title || currentEnteredMeta?.title || selectedCompetition;

  return (
    <div className="arena-container">
      {/* 1. Top Header Banner */}
      <ArenaHeader
        selectedCompetition={selectedCompetition}
        onCompetitionChange={handleCompetitionChange}
        competitionOptions={competitionOptions}
        hasSimData={hasSimData}
        isFinished={isFinished}
        refreshing={refreshing}
        onRefresh={() => void loadArenaData(true)}
      />

      {/* 2. Main Content Layout */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: '#64748b', fontSize: 13 }}>
            正在载入天梯战况与对局流水...
          </div>
        </div>
      ) : hasSimData ? (
        /* 2A. Active/Finished Simulation Arena - Full width */
        <div className="arena-content-stack" style={{ width: '100%' }}>
          {/* Section Header */}
          <div className="arena-section-header">
            <div className="arena-section-title-group">
              <h2 className="arena-section-title">
                {currentTitle}
              </h2>
              <span className="arena-section-desc">
                {isFinished
                  ? '终榜存档 · 最终 ELO 战况与全赛程对局复盘'
                  : '实时对抗 · ELO 积分追踪与动态安全垫评估'}
              </span>
            </div>
          </div>

          {/* Peer 1: Agent Stats Grid */}
          <AgentStatsGrid
            agents={agents}
            thresholds={thresholds}
            isFinished={isFinished}
            getAgentMeta={getAgentMeta}
          />

          {/* Peer 2: Medal Cutoff Panel */}
          <MedalCutoffTrack
            thresholds={thresholds}
            agents={agents}
            totalTeams={thresholds?.total_teams || compInfo?.team_count || currentEnteredMeta?.team_count || 1000}
            isFinished={isFinished}
            getAgentMeta={getAgentMeta}
          />

          {/* Peer 3: Score Trajectory Panel */}
          <ScoreTrajectoryChart
            agents={agents}
            thresholds={thresholds}
            competitionTitle={currentTitle}
          />
        </div>
      ) : (
        /* 2B. Standby View */
        <ArenaStandbyView
          selectedCompetition={selectedCompetition}
          currentTitle={currentTitle}
          compInfo={compInfo}
          currentEnteredMeta={currentEnteredMeta}
          formatDate={formatDate}
          onNavigateToKernels={() => window.location.assign('/kernels')}
        />
      )}
    </div>
  );
};

export default SimulationArena;
