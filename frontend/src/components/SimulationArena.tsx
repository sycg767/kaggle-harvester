import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App as AntApp,
  Spin,
  Alert,
} from 'antd';
import {
  api,
  type CompetitionInfo,
  type EnteredCompetition,
  type SimulationArenaSnapshot,
} from '../api';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import { HARVESTER_EVENTS } from '../events';
import { isCompetitionEnded, parseKaggleDeadline } from '../competitionOptions';
import ScoreTrajectoryChart from './ScoreTrajectoryChart';
import ArenaHistoryPicker from './arena/ArenaHistoryPicker';
import { readArenaCompetition, saveArenaCompetition, selectSimulationData } from './arena/arenaData';
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

  const [selectedCompetition, setSelectedCompetition] = useState<string>(() => {
    return readArenaCompetition(localStorage);
  });
  const [loadError, setLoadError] = useState('');
  const [selectedRun, setSelectedRun] = useState<string>();
  const [simSnapshot, setSimSnapshot] = useState<SimulationArenaSnapshot | null>(null);
  const [enteredComps, setEnteredComps] = useState<EnteredCompetition[]>([]);
  const [compInfo, setCompInfo] = useState<CompetitionInfo | null>(null);
  const requestVersion = useRef(0);

  const handleCompetitionChange = (comp: string) => {
    if (comp === selectedCompetition) return;
    requestVersion.current += 1;
    setLoading(true);
    setLoadError('');
    setSelectedRun(undefined);
    setSelectedCompetition(comp);
    if (!saveArenaCompetition(localStorage, comp)) {
      message.warning('已切换本页赛事，但浏览器未能保存选择；重新打开后可能需要再次选择。');
    }
  };

  useEffect(() => {
    let active = true;
    void getEnteredCompetitions().then((list) => { if (active) setEnteredComps(list); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const loadArenaData = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);

    try {
      const sim = await api.getSimulationArena(selectedCompetition || undefined, selectedRun);
      if (version !== requestVersion.current) return;
      if (selectedCompetition && sim.competition !== selectedCompetition) {
        throw new Error('返回数据的赛事与当前选择不一致');
      }
      setLoadError('');
      setSimSnapshot(sim);
      if (!selectedCompetition && sim.competition) {
        setSelectedCompetition(sim.competition);
      }
    } catch (err: unknown) {
      if (version === requestVersion.current) {
        setLoadError(err instanceof Error ? err.message : '请求失败，请稍后重试');
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, [selectedCompetition, selectedRun]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (quiet = false) => {
      await loadArenaData(quiet);
      if (active) timer = setTimeout(() => void poll(true), 30000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [loadArenaData]);

  useEffect(() => {
    const refresh = () => { void loadArenaData(true); };
    window.addEventListener(HARVESTER_EVENTS.simulationChanged, refresh);
    return () => window.removeEventListener(HARVESTER_EVENTS.simulationChanged, refresh);
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

  const currentSnapshot = simSnapshot?.competition === selectedCompetition && (!selectedRun || simSnapshot.run_id === selectedRun) ? simSnapshot : null;
  const simStatus = currentSnapshot?.status;
  const configuredSimComp = simSnapshot?.monitored_competition || '';
  const selectedCompInfo = compInfo?.id === selectedCompetition ? compInfo : null;

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
      seen.add(configuredSimComp);
      list.push({
        value: configuredSimComp,
        label: `${configuredSimComp} (当前配置)`,
      });
    }
    if (selectedCompetition && !seen.has(selectedCompetition)) {
      list.push({ value: selectedCompetition, label: selectedCompetition });
    }

    return list;
  }, [enteredComps, configuredSimComp, isSimulationCompetition, selectedCompetition]);

  const { matches: matchesCompetition, agents, thresholds } = selectSimulationData(simStatus, selectedCompetition);
  const hasSimData = agents.length > 0;
  const isFinished = isCompetitionEnded(selectedCompInfo?.deadline || currentEnteredMeta?.deadline);
  const isHistorical = currentSnapshot?.source === 'history';

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

  const currentTitle = selectedCompInfo?.title || currentEnteredMeta?.title || selectedCompetition;

  return (
    <div className="arena-container">
      {/* 1. Top Header Banner */}
      <ArenaHeader
        selectedCompetition={selectedCompetition}
        onCompetitionChange={handleCompetitionChange}
        competitionOptions={competitionOptions}
        hasSimData={hasSimData}
        isFinished={isFinished}
        isHistorical={isHistorical}
      />

      <ArenaHistoryPicker key={selectedCompetition} competition={selectedCompetition} selectedRun={selectedRun} onSelect={run => {
        requestVersion.current += 1; setLoading(true); setLoadError(''); setSelectedRun(run);
      }} />

      {isHistorical && (
        <Alert
          style={{ marginBottom: 16 }} showIcon type="info"
          message={`历史采集快照 · ${formatDate(currentSnapshot?.captured_at || undefined)}`}
          description={`展示该赛事${selectedRun ? '所选时刻' : '最近一次'}已保存的采集结果，不代表最终榜单。查看历史不会切换顶部全局赛事或后台监控任务。`}
        />
      )}
      {currentSnapshot?.source === 'current' && (
        <div className="arena-freshness" style={{ marginBottom: 16, fontSize: 12, color: '#64748b' }}>
          数据采集时间：{formatDate(currentSnapshot.captured_at || undefined)}
          {' · '}最近检查：{formatDate(simStatus?.last_checked_at)}
          {' · '}{simStatus?.running ? '正在采集' : !simStatus?.enabled ? '自动监控已停用' : simStatus?.scheduler_alive ? '等待下次调度' : '调度器未运行'}
        </div>
      )}
      {(loadError || currentSnapshot?.warning || (matchesCompetition && simStatus?.last_error)) && (
        <Alert
          style={{ marginBottom: 16 }} showIcon type="warning"
          message={loadError ? (hasSimData ? '本次刷新失败，保留上次数据' : '赛事数据读取失败') : isHistorical ? '历史采集记录提示' : '最近一次采集异常'}
          description={loadError || currentSnapshot?.warning || simStatus?.last_error}
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
            totalTeams={thresholds?.total_teams ?? selectedCompInfo?.team_count ?? currentEnteredMeta?.team_count}
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
      ) : loadError ? null : (
        /* 2B. Standby View */
        <ArenaStandbyView
          selectedCompetition={selectedCompetition}
          currentTitle={currentTitle}
          compInfo={selectedCompInfo}
          currentEnteredMeta={currentEnteredMeta}
          isFinished={isFinished}
          formatDate={formatDate}
          onNavigateToKernels={() => window.location.assign('/kernels')}
        />
      )}
    </div>
  );
};

export default SimulationArena;
