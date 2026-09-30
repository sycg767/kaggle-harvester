import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Spin,
  Alert,
} from 'antd';
import {
  api,
  type CompetitionInfo,
  type EnteredCompetition,
  type SimulationMonitorSnapshot,
} from '../api';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import { HARVESTER_EVENTS, dispatchCompetitionChanged } from '../events';
import { isCompetitionEnded, parseKaggleDeadline } from '../competitionOptions';
import ScoreTrajectoryChart from './ScoreTrajectoryChart';
import { selectSimulationData } from './arena/arenaData';
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
    return localStorage.getItem('harvester.competition') || localStorage.getItem('harvester.arenaCompetition') || '';
  });
  const [loadError, setLoadError] = useState(false);
  const [simSnapshot, setSimSnapshot] = useState<SimulationMonitorSnapshot | null>(null);
  const [enteredComps, setEnteredComps] = useState<EnteredCompetition[]>([]);
  const [compInfo, setCompInfo] = useState<CompetitionInfo | null>(null);

  const handleCompetitionChange = (comp: string) => {
    setSelectedCompetition(comp);
    localStorage.setItem('harvester.competition', comp);
    localStorage.setItem('harvester.arenaCompetition', comp);
    dispatchCompetitionChanged(comp);
  };

  useEffect(() => {
    const handleCompChange = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      const slug = customEvent.detail;
      if (slug && slug !== selectedCompetition) {
        setSelectedCompetition(slug);
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

      setLoadError(!sim);
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

  useEffect(() => {
    let active = true;
    setCompInfo(null);
    if (selectedCompetition) {
      void api.getCompetition(selectedCompetition).then(info => { if (active) setCompInfo(info); })
        .catch(() => { if (active) setCompInfo(null); });
    }
    return () => { active = false; };
  }, [selectedCompetition]);

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
  const configuredSimComp = simSnapshot?.config?.competition || simStatus?.competition || '';

  // Clean competition options without result leaks or redundant tags
  const competitionOptions = useMemo(() => {
    const list: Array<{ value: string; label: string; tag?: string }> = [];
    const seen = new Set<string>();

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

  const { matches: matchesCompetition, agents, thresholds } = selectSimulationData(simStatus, selectedCompetition);
  const hasSimData = agents.length > 0;
  const isFinished = isCompetitionEnded(compInfo?.deadline || currentEnteredMeta?.deadline);

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

      {(loadError || (matchesCompetition && simStatus?.last_error)) && (
        <Alert
          style={{ marginBottom: 16 }} showIcon type="warning"
          message={loadError ? '本次刷新失败，已有数据可能过期' : '最近一次采集异常'}
          description={matchesCompetition && simStatus?.last_error ? simStatus.last_error : undefined}
        />
      )}
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
                  ? '赛事已截止 · 对战记录'
                  : '积分走势与奖牌线'}
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
            totalTeams={thresholds?.total_teams ?? compInfo?.team_count ?? currentEnteredMeta?.team_count}
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
