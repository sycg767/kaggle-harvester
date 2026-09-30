import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Col,
  Row,
  Typography,
  Tag,
  Space,
  Spin,
  App as AntApp,
} from 'antd';
import {
  Swords,
  Trophy,
} from 'lucide-react';
import {
  api,
  type CompetitionInfo,
  type EnteredCompetition,
  type HealthStatus,
  type SimulationAgentStats,
  type SimulationMonitorSnapshot,
} from '../api';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import { HARVESTER_EVENTS, dispatchCompetitionChanged } from '../events';
import ScoreTrajectoryChart from './ScoreTrajectoryChart';
import {
  AgentStatsGrid,
  ArenaHeader,
  ArenaStandbyView,
  ClawbotSidebarCard,
  MedalCutoffTrack,
  getAgentMeta,
} from './arena';

const { Text } = Typography;

const formatDate = (value?: string) => {
  if (!value) return '—';
  let normalized = value.trim();
  if (
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(normalized)
    && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
  ) {
    normalized = `${normalized.replace(' ', 'T')}Z`;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const SimulationArena: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [simSnapshot, setSimSnapshot] = useState<SimulationMonitorSnapshot | null>(null);
  const [enteredComps, setEnteredComps] = useState<EnteredCompetition[]>([]);
  const [compInfo, setCompInfo] = useState<CompetitionInfo | null>(null);
  const [testingClawbot, setTestingClawbot] = useState(false);
  const [selectedCompetition, setSelectedCompetition] = useState<string>(() => {
    return localStorage.getItem('harvester.competition') || localStorage.getItem('harvester.arenaCompetition') || '';
  });

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

  const handleTestClawbot = async () => {
    setTestingClawbot(true);
    try {
      const res = await api.testClawbot();
      if (res.success) {
        message.success(res.message);
      } else {
        message.warning(res.message);
      }
      await loadArenaData(true);
    } catch (err: any) {
      message.error(`网关探测失败: ${err.message}`);
    } finally {
      setTestingClawbot(false);
    }
  };

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
  }, [message, selectedCompetition]);

  useEffect(() => {
    void loadArenaData();
    const interval = setInterval(() => {
      void loadArenaData(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [loadArenaData]);

  const handleCompetitionChange = (comp: string) => {
    setSelectedCompetition(comp);
    localStorage.setItem('harvester.competition', comp);
    localStorage.setItem('harvester.arenaCompetition', comp);
    dispatchCompetitionChanged(comp);
    void api.getCompetition(comp).then(setCompInfo).catch(() => setCompInfo(null));
  };

  const simStatus = simSnapshot?.status;
  const agents = simStatus?.agents || [];
  const thresholds = simStatus?.thresholds || simStatus?.medal_thresholds;
  const clawbot = simStatus?.clawbot;

  const configuredSimComp = simSnapshot?.config?.competition || simStatus?.competition || 'pokemon-tcg-ai-battle';
  const hasSimData = (selectedCompetition === configuredSimComp) && (agents.length > 0);

  const isPokemon = selectedCompetition === 'pokemon-tcg-ai-battle';
  const isFinished = isPokemon || Boolean(compInfo?.deadline && new Date(compInfo.deadline).getTime() < Date.now());

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

  const competitionOptions = useMemo(() => {
    const list: Array<{ value: string; label: string; tag?: string }> = [];
    const seen = new Set<string>();

    list.push({
      value: 'pokemon-tcg-ai-battle',
      label: '🏆 宝可梦 TCG (模拟对战 · 已完赛 · 银牌 Top 244)',
      tag: '已完赛',
    });
    seen.add('pokemon-tcg-ai-battle');

    const validSimComps = enteredComps.filter(isSimulationCompetition);
    for (const comp of validSimComps) {
      if (seen.has(comp.id)) continue;
      seen.add(comp.id);

      const isOngoing = !comp.deadline || new Date(comp.deadline).getTime() > Date.now();
      let displayName = comp.title && comp.title !== comp.id ? comp.title : comp.id;
      if (comp.id === 'kaggriculture') {
        displayName = 'Kaggriculture 智能体农场经营模拟对抗';
      }

      list.push({
        value: comp.id,
        label: isOngoing
          ? `⚔️ ${displayName} (进行中 · 备战中)`
          : `⚔️ ${displayName} (已完赛)`,
        tag: isOngoing ? '备战中' : '已完赛',
      });
    }

    if (configuredSimComp && !seen.has(configuredSimComp)) {
      list.push({
        value: configuredSimComp,
        label: `⚔️ ${configuredSimComp} (当前配置)`,
        tag: '当前配置',
      });
    }

    return list;
  }, [enteredComps, configuredSimComp, isSimulationCompetition]);

  const currentEnteredMeta = enteredComps.find((c) => c.id === selectedCompetition);
  const currentTitle = compInfo?.title || currentEnteredMeta?.title || selectedCompetition;

  const diskFreeGB = health?.archive
    ? (health.archive.disk_free_bytes / 1024 / 1024 / 1024).toFixed(1)
    : '—';

  const bestAgent = agents.reduce<SimulationAgentStats | null>((best, cur) => {
    if (!best) return cur;
    if (cur.rank && (!best.rank || cur.rank < best.rank)) return cur;
    return best;
  }, null);
  const totalEpisodesCount = agents.reduce((max, a) => Math.max(max, a.total_episodes || 0), 0);

  return (
    <div style={{ padding: '8px 0 32px 0', maxWidth: 1440, margin: '0 auto' }}>
      {/* 1. Header Banner with Dynamic Competition Selector */}
      <ArenaHeader
        selectedCompetition={selectedCompetition}
        onCompetitionChange={handleCompetitionChange}
        competitionOptions={competitionOptions}
        hasSimData={hasSimData}
        isFinished={isFinished}
        refreshing={refreshing}
        onRefresh={() => void loadArenaData(true)}
      />

      {loading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '80px 0', gap: 12 }}>
          <Spin size="large" />
          <span style={{ color: '#64748b', fontSize: 13 }}>正在载入天梯战况与对局流水...</span>
        </div>
      ) : hasSimData ? (
        /* 2A. Main Content Row: Rendered when competition HAS tracked simulation data (e.g. Pokemon TCG) */
        <Row gutter={[18, 18]} style={{ marginBottom: 22 }}>
          {/* Left: Simulation Arena Battle Showcase */}
          <Col xs={24} lg={15}>
            <Card
              className="dashboard-glow-card"
              style={{
                height: '100%',
                borderRadius: 14,
                border: '1px solid #e2e8f0',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.03)',
              }}
              styles={{ body: { padding: '20px 22px' } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <Space align="center" size={10}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: '#fef3c7', display: 'grid', placeItems: 'center' }}>
                    {isFinished ? <Trophy size={19} color="#d97706" /> : <Swords size={19} color="#d97706" />}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                        {isPokemon ? 'Pokemon TCG AI Battle' : currentTitle} — {isFinished ? '终榜总结战报' : '天梯战况'}
                      </span>
                      {isFinished ? (
                        <Tag color="cyan" style={{ margin: 0, fontWeight: 700 }}>🏁 终榜定格</Tag>
                      ) : (
                        <Tag color="gold" style={{ margin: 0, fontWeight: 700 }}>⚔️ 天梯对抗中</Tag>
                      )}
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {isFinished
                        ? '已完赛封榜存档 · 最终 ELO 积分、奖牌线定格与全赛程对局复盘'
                        : '活跃模拟对战中 · 实时 ELO 积分与安全垫评估'}
                    </Text>
                  </div>
                </Space>

                <Space size={8}>
                  {isFinished && (
                    <Tag color="purple" style={{ margin: 0 }}>
                      总对局: {totalEpisodesCount || 1331} 场 (胜率 {bestAgent?.win_rate?.toFixed(1) || '55.0'}%)
                    </Tag>
                  )}
                </Space>
              </div>

              {/* Dynamic Agents Quick Stats Grid */}
              <AgentStatsGrid
                agents={agents}
                thresholds={thresholds}
                isFinished={isFinished}
                getAgentMeta={getAgentMeta}
              />

              {/* Thresholds Waterline Multi-Segment Indicator */}
              <MedalCutoffTrack
                thresholds={thresholds}
                agents={agents}
                totalTeams={thresholds?.total_teams || compInfo?.team_count || currentEnteredMeta?.team_count || 1000}
                isFinished={isFinished}
                getAgentMeta={getAgentMeta}
              />

              <ScoreTrajectoryChart
                agents={agents}
                thresholds={thresholds}
              />
            </Card>
          </Col>

          {/* Right: WeChat ClawBot Hub */}
          <Col xs={24} lg={9}>
            <ClawbotSidebarCard
              clawbot={clawbot}
              testingClawbot={testingClawbot}
              onTestClawbot={handleTestClawbot}
              isFinished={isFinished}
              diskFreeGB={diskFreeGB}
              healthReady={health?.ready}
            />
          </Col>
        </Row>
      ) : (
        /* 2B. Standby & Ready View: Rendered when user selects a competition that is not yet actively monitored */
        <ArenaStandbyView
          selectedCompetition={selectedCompetition}
          currentTitle={currentTitle}
          compInfo={compInfo}
          currentEnteredMeta={currentEnteredMeta}
          formatDate={formatDate}
          clawbot={clawbot}
          testingClawbot={testingClawbot}
          onTestClawbot={handleTestClawbot}
          diskFreeGB={diskFreeGB}
          healthReady={health?.ready}
          onNavigateToKernels={() => navigate('/kernels')}
        />
      )}
    </div>
  );
};

export default SimulationArena;
