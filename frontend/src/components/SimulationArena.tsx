import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Col,
  Row,
  Typography,
  Button,
  Tag,
  Space,
  Spin,
  Tooltip,
  Select,
  Empty,
  App as AntApp,
} from 'antd';
import {
  Swords,
  Trophy,
  RefreshCw,
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
import { competitionDisplayName } from '../competitionOptions';
import { HARVESTER_EVENTS, dispatchCompetitionChanged } from '../events';
import SimulationMonitorControl from './SimulationMonitorControl';
import ScoreTrajectoryChart from './ScoreTrajectoryChart';
import ClawbotSidebarCard from './arena/ClawbotSidebarCard';
import ArenaStandbyView from './arena/ArenaStandbyView';
import MedalCutoffTrack from './arena/MedalCutoffTrack';

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
    return localStorage.getItem('harvester.competition') || localStorage.getItem('harvester.arenaCompetition') || 'pokemon-tcg-ai-battle';
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

      const targetComp = selectedCompetition || sim?.config?.competition || 'pokemon-tcg-ai-battle';
      void api.getCompetition(targetComp).then(setCompInfo).catch(() => setCompInfo(null));
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

  // Check if currently selected competition is the one with active simulation data in cache
  const configuredSimComp = simSnapshot?.config?.competition || simStatus?.competition || 'pokemon-tcg-ai-battle';
  const hasSimData = (selectedCompetition === configuredSimComp) && (agents.length > 0);

  const isPokemon = selectedCompetition === 'pokemon-tcg-ai-battle';
  const isFinished = isPokemon || Boolean(compInfo?.deadline && new Date(compInfo.deadline).getTime() < Date.now());

  // 精确识别模拟对抗赛 (Simulation Arena Competitions)
  const isSimulationCompetition = useCallback((c: EnteredCompetition) => {
    if (c.is_simulation === true) return true;
    if (c.tags?.some((t) => t.toLowerCase().includes('simulation'))) return true;
    const id = c.id.toLowerCase();
    // 显式排除非模拟竞赛：策略报告、医学影像、细胞追踪、地质勘探、安全攻击
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

  // 仅列出真正属于模拟对战的赛事 (宝可梦 TCG、Kaggriculture 等)
  const competitionOptions = useMemo(() => {
    const list: Array<{ value: string; label: string; tag?: string }> = [];
    const seen = new Set<string>();

    // 1. 宝可梦 TCG (已完赛)
    list.push({
      value: 'pokemon-tcg-ai-battle',
      label: '🏆 宝可梦 TCG (模拟对战 · 已完赛 · 银牌 Top 244)',
      tag: '已完赛',
    });
    seen.add('pokemon-tcg-ai-battle');

    // 2. 仅添加真实参加的天梯模拟对抗赛事 (例如 kaggriculture)
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

    // 3. 若当前正在后台监控的赛事不在列表中且通过了模拟赛校验，补充进去
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

  const formatScore = (val?: number | null) => (val !== undefined && val !== null ? val.toFixed(1) : '—');

  const diskFreeGB = health?.archive
    ? (health.archive.disk_free_bytes / 1024 / 1024 / 1024).toFixed(1)
    : '—';

  const getAgentMeta = (agent: SimulationAgentStats, index: number) => {
    const themes = [
      { tagColor: 'green', borderColor: '#bbf7d0', bg: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)' },
      { tagColor: 'purple', borderColor: '#e9d5ff', bg: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)' },
      { tagColor: 'blue', borderColor: '#bfdbfe', bg: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)' },
      { tagColor: 'orange', borderColor: '#fed7aa', bg: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)' },
    ];
    const theme = themes[index % themes.length];

    const customAlias = agent.alias?.trim();
    if (customAlias) {
      const displayName = customAlias.toLowerCase().startsWith('agent') ? customAlias : `Agent ${customAlias}`;
      return { name: displayName, shortName: customAlias, ...theme };
    }

    if (agent.submission_id === 55565346) return { name: 'Agent p46', shortName: 'p46', tagColor: 'green', borderColor: '#bbf7d0', bg: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)' };
    if (agent.submission_id === 55555162) return { name: 'Agent p31', shortName: 'p31', tagColor: 'purple', borderColor: '#e9d5ff', bg: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)' };
    const raw = (agent.description || agent.file_name || '').trim();
    const match = raw.match(/^(p\d+(?:plus\d+)?|p\d+|agent[\s\-_]?\w+)/i);
    if (match) {
      const clean = match[1].replace(/[:_\-—]+$/, '');
      const displayName = clean.toLowerCase().startsWith('agent') ? clean : `Agent ${clean}`;
      return { name: displayName, shortName: clean, ...theme };
    }
    return { name: `Agent #${index + 1}`, shortName: `Agent #${index + 1}`, ...theme };
  };

  const bestAgent = agents.reduce<SimulationAgentStats | null>((best, cur) => {
    if (!best) return cur;
    if (cur.rank && (!best.rank || cur.rank < best.rank)) return cur;
    return best;
  }, null);
  const totalEpisodesCount = agents.reduce((max, a) => Math.max(max, a.total_episodes || 0), 0);

  return (
    <div style={{ padding: '8px 0 32px 0', maxWidth: 1440, margin: '0 auto' }}>
      {/* 1. Header Banner with Dynamic Competition Selector */}
      <div
        style={{
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          borderRadius: 14,
          border: '1px solid #e2e8f0',
          padding: '20px 24px',
          marginBottom: 20,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <Space align="center" size={14}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#fffbeb',
              display: 'grid',
              placeItems: 'center',
              border: '1px solid #fde68a',
            }}
          >
            <Swords size={24} color="#d97706" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 20, color: '#0f172a' }}>
                天梯对抗竞技场 (Simulation Arena)
              </span>
              {hasSimData && isFinished ? (
                <Tag color="cyan" style={{ fontWeight: 700, margin: 0 }}>🏁 已完赛封榜存档</Tag>
              ) : hasSimData ? (
                <Tag color="gold" style={{ fontWeight: 700, margin: 0 }}>⚔️ 实时对抗巡检中</Tag>
              ) : (
                <Tag color="blue" style={{ fontWeight: 700, margin: 0 }}>⏳ 备战待命中 (未启用巡检)</Tag>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>
              支持仿真对抗赛事 ELO 积分追踪、对局流水回放、多 Agent 战力矩阵与奖牌安全垫评估
            </div>
          </div>
        </Space>

        <Space size={10} wrap>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>赛事切换:</span>
            <Select
              value={selectedCompetition}
              onChange={handleCompetitionChange}
              style={{ minWidth: 320 }}
              options={competitionOptions}
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>
          <SimulationMonitorControl currentCompetition={selectedCompetition} />
          <Button
            icon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />}
            loading={refreshing}
            onClick={() => void loadArenaData(true)}
          >
            刷新
          </Button>
        </Space>
      </div>

      {loading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '80px 0', gap: 12 }}>
          <Spin size="large" />
          <span style={{ color: '#64748b', fontSize: 13 }}>正在载入天梯战况与对局流水...</span>
        </div>
      ) : hasSimData ? (
        /* 2A. Main Content Row: Rendered when competition HAS tracked simulation data (e.g. Pokemon TCG) */
        <>
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
                <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
                  {agents.length === 0 ? (
                    <Col span={24}>
                      <div style={{ padding: '24px 16px', background: '#f8fafc', borderRadius: 10, textAlign: 'center', color: '#94a3b8' }}>
                        当前比赛暂无监控的 Agent 提交记录，点击右上角「模拟对战监控」可添加追踪选手
                      </div>
                    </Col>
                  ) : (
                    agents.map((agent, index) => {
                      const meta = getAgentMeta(agent, index);
                      const scoreVal = agent.score ?? agent.public_score;
                      const gap = agent.bronze_gap_score;
                      const isAboveBronze = (gap !== undefined && gap !== null && gap >= 0)
                        || agent.medal_tier === 'bronze'
                        || agent.medal_tier === 'silver'
                        || agent.medal_tier === 'gold';
                      const ep = agent.recent_episodes?.[0];
                      const opp = ep?.opponent_team_name || '';
                      const res = ep?.result === 'win' ? '胜' : (ep?.result === 'loss' ? '负' : (ep?.result === 'tie' ? '平' : ''));
                      const resColor = ep?.result === 'win' ? '#16a34a' : (ep?.result === 'loss' ? '#e11d48' : '#64748b');
                      const delta = ep?.score_delta !== undefined ? (ep.score_delta >= 0 ? `+${ep.score_delta.toFixed(1)}` : ep.score_delta.toFixed(1)) : '';
                      const colSpan = agents.length === 1 ? 24 : 12;

                      return (
                        <Col xs={24} sm={colSpan} key={agent.submission_id || index}>
                          <div
                            style={{
                              background: isAboveBronze ? meta.bg : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                              border: isAboveBronze ? `1px solid ${meta.borderColor}` : '1px solid #e2e8f0',
                              borderRadius: 10,
                              padding: '14px 16px',
                              height: '100%',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <Tag color={meta.tagColor} style={{ fontWeight: 700, margin: 0 }}>
                                  {meta.name} {agent.submission_id ? `(#${agent.submission_id})` : ''}
                                </Tag>
                                {agent.medal_tier === 'gold' ? (
                                  <Tag color="gold" icon={<Trophy size={11} style={{ marginRight: 2 }} />}>🥇 金牌区</Tag>
                                ) : agent.medal_tier === 'silver' ? (
                                  <Tag color="cyan" icon={<Trophy size={11} style={{ marginRight: 2 }} />}>🥈 银牌区</Tag>
                                ) : isAboveBronze ? (
                                  <Tag color="orange" icon={<Trophy size={11} style={{ marginRight: 2 }} />}>🥉 铜牌线内</Tag>
                                ) : gap !== undefined && gap !== null ? (
                                  <Tag color="default">距铜牌 {gap.toFixed(1)}分</Tag>
                                ) : (
                                  <Tag color="default">未入围</Tag>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                <span style={{ fontSize: 26, fontWeight: 900, color: isAboveBronze ? '#166534' : '#334155' }}>
                                  {formatScore(scoreVal)}
                                </span>
                                <span style={{ fontSize: 12, color: isAboveBronze ? '#15803d' : '#64748b' }}>
                                  分 ({agent.rank ? `第 ${agent.rank} 名` : '未上榜'})
                                </span>
                              </div>
                            </div>

                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 12, color: isAboveBronze ? '#166534' : '#475569', display: 'flex', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 4 }}>
                                <span>胜率: {agent.win_rate !== undefined ? agent.win_rate.toFixed(1) : '—'}% ({agent.wins ?? 0}胜/{agent.losses ?? 0}负)</span>
                                {(() => {
                                  const score = agent.score ?? agent.public_score ?? 0;
                                  const tier = agent.medal_tier || 'none';
                                  if (isFinished) {
                                    if (tier === 'gold') return <span style={{ fontWeight: 700, color: '#ca8a04' }}>🥇 终榜锁定: 金牌</span>;
                                    if (tier === 'silver') return <span style={{ fontWeight: 700, color: '#0284c7' }}>🥈 终榜锁定: 银牌</span>;
                                    if (tier === 'bronze') return <span style={{ fontWeight: 700, color: '#16a34a' }}>🥉 终榜锁定: 铜牌</span>;
                                  }
                                  if (tier === 'gold') {
                                    const c = agent.tier_cushion_score ?? (thresholds?.gold_cutoff_score ? score - thresholds.gold_cutoff_score : 0);
                                    return <span style={{ fontWeight: 700, color: '#ca8a04' }}>金牌安全垫: +{c.toFixed(1)}分</span>;
                                  }
                                  if (tier === 'silver') {
                                    const c = agent.tier_cushion_score ?? (thresholds?.silver_cutoff_score ? score - thresholds.silver_cutoff_score : 0);
                                    return <span style={{ fontWeight: 700, color: '#0284c7' }}>银牌安全垫: +{c.toFixed(1)}分</span>;
                                  }
                                  if (tier === 'bronze') {
                                    const c = agent.tier_cushion_score ?? agent.bronze_gap_score ?? (thresholds?.bronze_cutoff_score ? score - thresholds.bronze_cutoff_score : 0);
                                    return <span style={{ fontWeight: 700, color: '#16a34a' }}>铜牌安全垫: +{c.toFixed(1)}分</span>;
                                  }
                                  const gapVal = agent.bronze_gap_score ?? (thresholds?.bronze_cutoff_score ? score - thresholds.bronze_cutoff_score : null);
                                  if (gapVal !== null && gapVal !== undefined) {
                                    return gapVal >= 0
                                      ? <span style={{ fontWeight: 700, color: '#16a34a' }}>铜牌安全垫: +{gapVal.toFixed(1)}分</span>
                                      : <span style={{ fontWeight: 700, color: '#e11d48' }}>距铜牌: {gapVal.toFixed(1)}分</span>;
                                  }
                                  return <span style={{ color: '#94a3b8' }}>安全垫: —</span>;
                                })()}
                              </div>
                              <div style={{ borderTop: isAboveBronze ? '1px solid rgba(22, 101, 52, 0.1)' : '1px solid #e2e8f0', paddingTop: 4 }}>
                                {ep ? (
                                  <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                                    {isFinished ? '封榜收官战: ' : '最新: '}vs {opp.length > 12 ? opp.slice(0, 12) + '..' : opp} <span style={{ color: resColor }}>{res} {delta}</span>
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

                {/* Thresholds Waterline Multi-Segment Indicator */}
                <MedalCutoffTrack
                  thresholds={thresholds}
                  agents={agents}
                  totalTeams={thresholds?.total_teams || 6807}
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
        </>
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
