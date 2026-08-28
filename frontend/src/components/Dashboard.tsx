import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Col,
  Row,
  Typography,
  Button,
  Tag,
  Progress,
  Space,
  Spin,
  Tooltip,
  App as AntApp,
} from 'antd';
import {
  Swords,
  Trophy,
  Bot,
  Zap,
  TrendingUp,
  Archive,
  ArrowRight,
  RefreshCw,
  Sparkles,
  LayoutDashboard,
  Bell,
  Activity,
  HardDrive,
  Cpu,
  Layers,
  ChevronRight,
  Smartphone,
} from 'lucide-react';
import {
  api,
  type HealthStatus,
  type SimulationMonitorSnapshot,
} from '../api';
import NotificationCenter from './NotificationCenter';
import SubmissionMonitorControl from './SubmissionMonitorControl';
import SimulationMonitorControl from './SimulationMonitorControl';
import AutoArchiveControl from './AutoArchiveControl';
import ScoreTrajectoryChart from './ScoreTrajectoryChart';

const { Text, Title, Paragraph } = Typography;

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [simSnapshot, setSimSnapshot] = useState<SimulationMonitorSnapshot | null>(null);
  const [testingClawbot, setTestingClawbot] = useState(false);
  const [currentCompetition, setCurrentCompetition] = useState<string>(() => {
    return localStorage.getItem('harvester.competition') || 'pokemon-tcg-ai-battle';
  });

  const handleTestClawbot = async () => {
    setTestingClawbot(true);
    try {
      const res = await api.testClawbot();
      if (res.success) {
        message.success(res.message);
      } else {
        message.warning(res.message);
      }
      await loadDashboardData(true);
    } catch (err: any) {
      message.error(`网关探测失败: ${err.message}`);
    } finally {
      setTestingClawbot(false);
    }
  };

  const loadDashboardData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);

    try {
      const [h, sim] = await Promise.all([
        api.health().catch(() => null),
        api.getSimulationMonitor().catch(() => null),
      ]);

      if (h) setHealth(h);
      if (sim) {
        setSimSnapshot(sim);
        if (sim.config?.competition) {
          setCurrentCompetition(sim.config.competition);
        }
      }
    } catch (err: any) {
      if (!quiet) message.error(`加载仪表盘数据失败: ${err.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [message]);

  useEffect(() => {
    void loadDashboardData();
    const interval = setInterval(() => {
      void loadDashboardData(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [loadDashboardData]);

  const simStatus = simSnapshot?.status;
  const agents = simStatus?.agents || [];
  const thresholds = simStatus?.thresholds || simStatus?.medal_thresholds;
  const clawbot = simStatus?.clawbot;

  // Key stats for Pokemon TCG
  const p46 = agents.find((a) => a.submission_id === 55565346) || agents[0];
  const p31 = agents.find((a) => a.submission_id === 55555162) || agents[1];

  const formatScore = (val?: number | null) => (val !== undefined && val !== null ? val.toFixed(1) : '—');

  const diskFreeGB = health?.archive
    ? (health.archive.disk_free_bytes / 1024 / 1024 / 1024).toFixed(1)
    : '—';

  return (
    <div style={{ padding: '8px 0 32px 0', maxWidth: 1440, margin: '0 auto' }}>

      {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', padding: '80px 0', gap: 12 }}>
            <Spin size="large" />
            <span style={{ color: '#64748b', fontSize: 13 }}>正在加载指挥中心全景数据...</span>
          </div>
      ) : (
        <>
          {/* 2. Core Feature Control Hub (4 Main Modules) */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <Space align="center" size={8}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#e0f2fe', display: 'grid', placeItems: 'center' }}>
                  <Zap size={16} color="#0284c7" />
                </div>
                <span style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                  核心功能与控制中枢
                </span>
                <Tag color="blue" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>
                  一键配置 · 实时运行
                </Tag>
              </Space>
            </div>

            <Row gutter={[16, 16]}>
              {/* Module 1: 通知中心 */}
              <Col xs={24} sm={12} xl={6}>
                <Card
                  className="dashboard-glow-card"
                  style={{
                    height: '100%',
                    borderRadius: 12,
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                  styles={{ body: { padding: '18px 20px', display: 'flex', flexDirection: 'column', height: '100%' } }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fef2f2', display: 'grid', placeItems: 'center' }}>
                        <Bell size={19} color="#ef4444" />
                      </div>
                      <Tag color="volcano" style={{ margin: 0 }}>Webhook / 邮件</Tag>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>
                      通知中心
                    </div>
                    <Paragraph type="secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
                      支持飞书、企业微信、钉钉、Slack、ntfy 及邮件多通道推送配置与测试。
                    </Paragraph>
                  </div>
                  <div style={{ paddingTop: 10, borderTop: '1px solid #f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                    <NotificationCenter />
                  </div>
                </Card>
              </Col>

              {/* Module 2: 出分监控 */}
              <Col xs={24} sm={12} xl={6}>
                <Card
                  className="dashboard-glow-card"
                  style={{
                    height: '100%',
                    borderRadius: 12,
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                  styles={{ body: { padding: '18px 20px', display: 'flex', flexDirection: 'column', height: '100%' } }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#ecfdf5', display: 'grid', placeItems: 'center' }}>
                        <Activity size={19} color="#10b981" />
                      </div>
                      <Tag color="green" style={{ margin: 0 }}>自动巡检</Tag>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>
                      提交出分监控
                    </div>
                    <Paragraph type="secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
                      后台定时拉取提交历史，实时解析最新 Public Leaderboard 分数与状态通知。
                    </Paragraph>
                  </div>
                  <div style={{ paddingTop: 10, borderTop: '1px solid #f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                    <SubmissionMonitorControl currentCompetition={currentCompetition} />
                  </div>
                </Card>
              </Col>

              {/* Module 3: 对战监控 */}
              <Col xs={24} sm={12} xl={6}>
                <Card
                  className="dashboard-glow-card"
                  style={{
                    height: '100%',
                    borderRadius: 12,
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                  styles={{ body: { padding: '18px 20px', display: 'flex', flexDirection: 'column', height: '100%' } }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fffbeb', display: 'grid', placeItems: 'center' }}>
                        <Swords size={19} color="#f59e0b" />
                      </div>
                      <Tag color="gold" style={{ margin: 0 }}>天梯对抗</Tag>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>
                      模拟对战监控
                    </div>
                    <Paragraph type="secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
                      支持宝可梦 TCG 等仿真竞赛的 ELO 积分追踪、对局回放与安全垫分析。
                    </Paragraph>
                  </div>
                  <div style={{ paddingTop: 10, borderTop: '1px solid #f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                    <SimulationMonitorControl currentCompetition={currentCompetition} />
                  </div>
                </Card>
              </Col>

              {/* Module 4: 自动归档 */}
              <Col xs={24} sm={12} xl={6}>
                <Card
                  className="dashboard-glow-card"
                  style={{
                    height: '100%',
                    borderRadius: 12,
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                  styles={{ body: { padding: '18px 20px', display: 'flex', flexDirection: 'column', height: '100%' } }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f5f3ff', display: 'grid', placeItems: 'center' }}>
                        <Archive size={19} color="#8b5cf6" />
                      </div>
                      <Tag color="purple" style={{ margin: 0 }}>自动下载</Tag>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>
                      智能自动归档
                    </div>
                    <Paragraph type="secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
                      按设定的高分阈值或排名定时自动下载开源 Notebook 源码、依赖与输出。
                    </Paragraph>
                  </div>
                  <div style={{ paddingTop: 10, borderTop: '1px solid #f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                    <AutoArchiveControl currentCompetition={currentCompetition} />
                  </div>
                </Card>
              </Col>
            </Row>
          </div>

          {/* 3. Middle Row: Pokemon TCG Live Battle Card + WeChat ClawBot Hub */}
          <Row gutter={[18, 18]} style={{ marginBottom: 22 }}>
            {/* Left: Pokemon TCG Real-Time Battle Status */}
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <Space align="center" size={8}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fef3c7', display: 'grid', placeItems: 'center' }}>
                      <Swords size={18} color="#d97706" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                        Pokemon TCG AI Battle — 天梯战况
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        活跃模拟对战中 · 实时 ELO 积分与安全垫评估
                      </Text>
                    </div>
                  </Space>

                  <SimulationMonitorControl currentCompetition={currentCompetition} />
                </div>

                {/* Dual Agents Quick Stats */}
                <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
                  {/* Agent p46 */}
                  <Col xs={24} sm={12}>
                    {(() => {
                      const scoreVal = p46?.score ?? p46?.public_score;
                      const gap = p46?.bronze_gap_score;
                      const isAboveBronze = (gap !== undefined && gap !== null && gap >= 0)
                        || p46?.medal_tier === 'bronze'
                        || p46?.medal_tier === 'silver'
                        || p46?.medal_tier === 'gold';
                      const ep = p46?.recent_episodes?.[0];
                      const opp = ep?.opponent_team_name || '';
                      const res = ep?.result === 'win' ? '胜' : (ep?.result === 'loss' ? '负' : (ep?.result === 'tie' ? '平' : ''));
                      const resColor = ep?.result === 'win' ? '#16a34a' : (ep?.result === 'loss' ? '#e11d48' : '#64748b');
                      const delta = ep?.score_delta !== undefined ? (ep.score_delta >= 0 ? `+${ep.score_delta.toFixed(1)}` : ep.score_delta.toFixed(1)) : '';

                      return (
                        <div
                          style={{
                            background: isAboveBronze
                              ? 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'
                              : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                            border: isAboveBronze ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
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
                              <Tag color="green" style={{ fontWeight: 700, margin: 0 }}>
                                Agent p46 {p46 ? `(#${p46.submission_id})` : '(#55565346)'}
                              </Tag>
                              {p46?.medal_tier === 'gold' ? (
                                <Tag color="gold" icon={<Trophy size={11} style={{ marginRight: 2 }} />}>🥇 金牌区</Tag>
                              ) : p46?.medal_tier === 'silver' ? (
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
                                分 ({p46?.rank ? `第 ${p46.rank} 名` : '未上榜'})
                              </span>
                            </div>
                          </div>

                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 12, color: isAboveBronze ? '#166534' : '#475569', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span>胜率: {p46?.win_rate !== undefined ? p46.win_rate.toFixed(1) : '—'}% ({p46?.wins ?? 0}胜/{p46?.losses ?? 0}负)</span>
                              {(() => {
                                const scoreVal = p46?.score ?? p46?.public_score ?? 0;
                                const tier = p46?.medal_tier || 'none';
                                if (tier === 'gold') {
                                  const c = p46?.tier_cushion_score ?? (thresholds?.gold_cutoff_score ? scoreVal - thresholds.gold_cutoff_score : 0);
                                  return <span style={{ fontWeight: 700, color: '#ca8a04' }}>金牌安全垫: +{c.toFixed(1)}分</span>;
                                }
                                if (tier === 'silver') {
                                  const c = p46?.tier_cushion_score ?? (thresholds?.silver_cutoff_score ? scoreVal - thresholds.silver_cutoff_score : 0);
                                  return <span style={{ fontWeight: 700, color: '#0284c7' }}>银牌安全垫: +{c.toFixed(1)}分</span>;
                                }
                                if (tier === 'bronze') {
                                  const c = p46?.tier_cushion_score ?? p46?.bronze_gap_score ?? (thresholds?.bronze_cutoff_score ? scoreVal - thresholds.bronze_cutoff_score : 0);
                                  return <span style={{ fontWeight: 700, color: '#16a34a' }}>铜牌安全垫: +{c.toFixed(1)}分</span>;
                                }
                                const gapVal = p46?.bronze_gap_score ?? (thresholds?.bronze_cutoff_score ? scoreVal - thresholds.bronze_cutoff_score : null);
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
                                  最新: vs {opp.length > 12 ? opp.slice(0, 12) + '..' : opp} <span style={{ color: resColor }}>{res} {delta}</span>
                                </span>
                              ) : (
                                <span style={{ fontSize: 12, color: '#94a3b8' }}>暂无近期对局记录</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </Col>

                  {/* Agent p31 */}
                  <Col xs={24} sm={12}>
                    {(() => {
                      const scoreVal = p31?.score ?? p31?.public_score;
                      const gap = p31?.bronze_gap_score;
                      const isAboveBronze = (gap !== undefined && gap !== null && gap >= 0)
                        || p31?.medal_tier === 'bronze'
                        || p31?.medal_tier === 'silver'
                        || p31?.medal_tier === 'gold';
                      const ep = p31?.recent_episodes?.[0];
                      const opp = ep?.opponent_team_name || '';
                      const res = ep?.result === 'win' ? '胜' : (ep?.result === 'loss' ? '负' : (ep?.result === 'tie' ? '平' : ''));
                      const resColor = ep?.result === 'win' ? '#16a34a' : (ep?.result === 'loss' ? '#e11d48' : '#64748b');
                      const delta = ep?.score_delta !== undefined ? (ep.score_delta >= 0 ? `+${ep.score_delta.toFixed(1)}` : ep.score_delta.toFixed(1)) : '';

                      return (
                        <div
                          style={{
                            background: isAboveBronze
                              ? 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'
                              : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                            border: isAboveBronze ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
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
                              <Tag color="purple" style={{ fontWeight: 700, margin: 0 }}>
                                Agent p31 {p31 ? `(#${p31.submission_id})` : '(#55555162)'}
                              </Tag>
                              {p31?.medal_tier === 'gold' ? (
                                <Tag color="gold" icon={<Trophy size={11} style={{ marginRight: 2 }} />}>🥇 金牌区</Tag>
                              ) : p31?.medal_tier === 'silver' ? (
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
                                分 ({p31?.rank ? `第 ${p31.rank} 名` : '未上榜'})
                              </span>
                            </div>
                          </div>

                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 12, color: isAboveBronze ? '#166534' : '#475569', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span>胜率: {p31?.win_rate !== undefined ? p31.win_rate.toFixed(1) : '—'}% ({p31?.wins ?? 0}胜/{p31?.losses ?? 0}负)</span>
                              {(() => {
                                const scoreVal = p31?.score ?? p31?.public_score ?? 0;
                                const tier = p31?.medal_tier || 'none';
                                if (tier === 'gold') {
                                  const c = p31?.tier_cushion_score ?? (thresholds?.gold_cutoff_score ? scoreVal - thresholds.gold_cutoff_score : 0);
                                  return <span style={{ fontWeight: 700, color: '#ca8a04' }}>金牌安全垫: +{c.toFixed(1)}分</span>;
                                }
                                if (tier === 'silver') {
                                  const c = p31?.tier_cushion_score ?? (thresholds?.silver_cutoff_score ? scoreVal - thresholds.silver_cutoff_score : 0);
                                  return <span style={{ fontWeight: 700, color: '#0284c7' }}>银牌安全垫: +{c.toFixed(1)}分</span>;
                                }
                                if (tier === 'bronze') {
                                  const c = p31?.tier_cushion_score ?? p31?.bronze_gap_score ?? (thresholds?.bronze_cutoff_score ? scoreVal - thresholds.bronze_cutoff_score : 0);
                                  return <span style={{ fontWeight: 700, color: '#16a34a' }}>铜牌安全垫: +{c.toFixed(1)}分</span>;
                                }
                                const gapVal = p31?.bronze_gap_score ?? (thresholds?.bronze_cutoff_score ? scoreVal - thresholds.bronze_cutoff_score : null);
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
                                  最新: vs {opp.length > 12 ? opp.slice(0, 12) + '..' : opp} <span style={{ color: resColor }}>{res} {delta}</span>
                                </span>
                              ) : (
                                <span style={{ fontSize: 12, color: '#94a3b8' }}>暂无近期对局记录</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </Col>
                </Row>

                {/* Thresholds Waterline Multi-Segment Indicator */}
                {(() => {
                  const totalTeams = thresholds?.total_teams || 6807;
                  const goldCutoff = thresholds?.gold_cutoff_score || 1148.0;
                  const goldRank = thresholds?.gold_cutoff_rank || 23;
                  const silverCutoff = thresholds?.silver_cutoff_score || 921.1;
                  const silverRank = thresholds?.silver_cutoff_rank || 340;
                  const bronzeCutoff = thresholds?.bronze_cutoff_score || 849.5;
                  const bronzeRank = thresholds?.bronze_cutoff_rank || 680;

                  const p46Score = p46?.score ?? p46?.public_score;
                  const p31Score = p31?.score ?? p31?.public_score;

                  // Compute visual scale bounds
                  const minVal = Math.min(bronzeCutoff - 120, (p46Score ?? 800) - 40, (p31Score ?? 800) - 40, 720);
                  const maxVal = Math.max(goldCutoff + 80, (p46Score ?? 950) + 40, (p31Score ?? 950) + 40, 1220);
                  const range = Math.max(1, maxVal - minVal);

                  const getPct = (score: number) => Math.min(98, Math.max(2, ((score - minVal) / range) * 100));

                  const posBronze = getPct(bronzeCutoff);
                  const posSilver = getPct(silverCutoff);
                  const posGold = getPct(goldCutoff);
                  const posP46 = p46Score !== undefined && p46Score !== null ? getPct(p46Score) : null;
                  const posP31 = p31Score !== undefined && p31Score !== null ? getPct(p31Score) : null;

                  return (
                    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', border: '1px solid #e2e8f0', marginBottom: 16 }}>
                      {/* Header Info */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#64748b', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                        <span style={{ fontWeight: 700, color: '#1e293b' }}>
                          🏆 奖牌线切分 (总计 {totalTeams} 支参赛队)
                        </span>
                        <Space size={14} wrap>
                          <Tooltip title={`Top 10 + 0.2% 队伍 (第 ${goldRank} 名及以上)`}>
                            <span style={{ color: '#ca8a04', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              🥇 金牌线: {goldCutoff.toFixed(1)}分 <span style={{ fontSize: 11, color: '#a16207' }}>(Top {goldRank})</span>
                            </span>
                          </Tooltip>
                          <Tooltip title={`Top 5% 队伍 (第 ${silverRank} 名及以上)`}>
                            <span style={{ color: '#0284c7', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              🥈 银牌线: {silverCutoff.toFixed(1)}分 <span style={{ fontSize: 11, color: '#0369a1' }}>(Top {silverRank})</span>
                            </span>
                          </Tooltip>
                          <Tooltip title={`Top 10% 队伍 (第 ${bronzeRank} 名及以上)`}>
                            <span style={{ color: '#d97706', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              🥉 铜牌线: {bronzeCutoff.toFixed(1)}分 <span style={{ fontSize: 11, color: '#b45309' }}>(Top {bronzeRank})</span>
                            </span>
                          </Tooltip>
                        </Space>
                      </div>

                      {/* Visual Multi-Segment Bar Container */}
                      <div style={{ position: 'relative', paddingTop: 26, paddingBottom: 22, margin: '0 8px' }}>
                        {/* Agent Pin Markers */}
                        {posP46 !== null && p46Score !== undefined && (
                          <Tooltip title={`Agent p46: ${p46Score.toFixed(1)}分 (${p46?.rank ? `第${p46.rank}名 · ` : ''}${p46?.medal_tier === 'gold' ? '🥇金牌区' : p46?.medal_tier === 'silver' ? '🥈银牌区' : p46?.medal_tier === 'bronze' ? '🥉铜牌区' : '暂无奖牌'})`}>
                            <div
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: `${posP46}%`,
                                transform: 'translateX(-50%)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                cursor: 'pointer',
                                zIndex: 3,
                              }}
                            >
                              <div
                                style={{
                                  background: '#2563eb',
                                  color: '#ffffff',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  boxShadow: '0 1px 4px rgba(37,99,235,0.4)',
                                  whiteSpace: 'nowrap',
                                  lineHeight: '14px',
                                }}
                              >
                                p46: {p46Score.toFixed(1)}
                              </div>
                              <div
                                style={{
                                  width: 0,
                                  height: 0,
                                  borderLeft: '4px solid transparent',
                                  borderRight: '4px solid transparent',
                                  borderTop: '5px solid #2563eb',
                                }}
                              />
                            </div>
                          </Tooltip>
                        )}

                        {posP31 !== null && p31Score !== undefined && (
                          <Tooltip title={`Agent p31: ${p31Score.toFixed(1)}分 (${p31?.rank ? `第${p31.rank}名 · ` : ''}${p31?.medal_tier === 'gold' ? '🥇金牌区' : p31?.medal_tier === 'silver' ? '🥈银牌区' : p31?.medal_tier === 'bronze' ? '🥉铜牌区' : '暂无奖牌'})`}>
                            <div
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: `${posP31}%`,
                                transform: 'translateX(-50%)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                cursor: 'pointer',
                                zIndex: 4,
                              }}
                            >
                              <div
                                style={{
                                  background: '#7c3aed',
                                  color: '#ffffff',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  boxShadow: '0 1px 4px rgba(124,58,237,0.4)',
                                  whiteSpace: 'nowrap',
                                  lineHeight: '14px',
                                }}
                              >
                                p31: {p31Score.toFixed(1)}
                              </div>
                              <div
                                style={{
                                  width: 0,
                                  height: 0,
                                  borderLeft: '4px solid transparent',
                                  borderRight: '4px solid transparent',
                                  borderTop: '5px solid #7c3aed',
                                }}
                              />
                            </div>
                          </Tooltip>
                        )}

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
                })()}

                <ScoreTrajectoryChart
                  agents={agents}
                  thresholds={thresholds}
                />
              </Card>
            </Col>

            {/* Right: WeChat ClawBot Hub */}
            <Col xs={24} lg={9}>
              <Card
                className="dashboard-glow-card"
                style={{
                  height: '100%',
                  borderRadius: 14,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.03)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
                styles={{ body: { padding: '20px 22px', display: 'flex', flexDirection: 'column', height: '100%' } }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Space align="center" size={8}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dcfce7', display: 'grid', placeItems: 'center' }}>
                        <Bot size={18} color="#16a34a" />
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                          微信 ClawBot 智能管家
                        </div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          官方长连接 · 实时问答与战报推送
                        </Text>
                      </div>
                    </Space>

                    <Space size={6}>
                      <Button
                        size="small"
                        icon={<RefreshCw size={12} className={testingClawbot ? 'animate-spin' : ''} />}
                        loading={testingClawbot}
                        onClick={() => void handleTestClawbot()}
                        style={{ fontSize: 12 }}
                      >
                        探测连通性
                      </Button>
                      <Tooltip
                        title={
                          clawbot?.is_online
                            ? 'OpenClaw 网关正在运行并保持微信长连接'
                            : clawbot?.configured
                            ? '已配置模型与插件，但本地/服务器 18789 端口未检测到 OpenClaw 网关运行'
                            : '未检测到 OpenClaw 配置文件或 OPENCLAW_LLM_API_KEY 环境变量'
                        }
                      >
                        <Tag
                          color={clawbot?.is_online ? 'success' : clawbot?.configured ? 'warning' : 'default'}
                          style={{ margin: 0, fontWeight: 700 }}
                        >
                          {clawbot?.is_online ? '在线' : clawbot?.configured ? '离线 (未启动)' : '未就绪'}
                        </Tag>
                      </Tooltip>
                    </Space>
                  </div>

                  {/* Model & Config Details */}
                  <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px', marginBottom: 14, border: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                      <span style={{ color: '#64748b' }}>大模型引擎:</span>
                      <span style={{ fontWeight: 700, color: '#0f172a' }}>{clawbot?.model || 'deepseek-v4-flash-0731'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                      <span style={{ color: '#64748b' }}>服务商:</span>
                      <span style={{ color: '#334155' }}>{clawbot?.provider || 'TokenRhythm Studio'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                      <span style={{ color: '#64748b' }}>网关探测:</span>
                      <span style={{ color: clawbot?.is_online ? '#16a34a' : '#d97706', fontWeight: 600 }}>
                        {clawbot?.is_online ? '活跃 (端口 18789)' : '未连接 (端口 18789)'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: '#64748b' }}>后台巡检:</span>
                      <span style={{ color: '#16a34a', fontWeight: 600 }}>每 10 分钟自动检查对局</span>
                    </div>
                  </div>

                  {/* WeChat Commands Quick List */}
                  <div style={{ fontSize: 12, color: '#475569', marginBottom: 14 }}>
                    <Space size={6} style={{ marginBottom: 6 }}>
                      <Smartphone size={14} color="#0284c7" />
                      <span style={{ fontWeight: 600, color: '#0f172a' }}>手机微信直接发送指令：</span>
                    </Space>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <Tag color="blue">战况</Tag>
                      <Tag color="gold">分数</Tag>
                      <Tag color="purple">排名</Tag>
                      <Tag color="cyan">刷新</Tag>
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    磁盘空间: <span style={{ fontWeight: 600, color: '#0f172a' }}>{diskFreeGB} GB</span> 可用
                  </Text>
                  <Tag color={health?.ready ? 'green' : 'orange'}>
                    {health?.ready ? 'CLI 凭据已就绪' : '检查凭据'}
                  </Tag>
                </div>
              </Card>
            </Col>
          </Row>

          {/* 4. Bottom Row: Quick Navigation & System Workspace */}
          <Row gutter={[18, 18]}>
            {/* Quick Link Card 1: Kernel 广场 */}
            <Col xs={24} md={12}>
              <Card
                className="dashboard-glow-card"
                hoverable
                onClick={() => navigate('/kernels')}
                style={{
                  borderRadius: 14,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.02)',
                  cursor: 'pointer',
                }}
                styles={{ body: { padding: '20px 24px' } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Space size={14} align="center">
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: '#eff6ff', display: 'grid', placeItems: 'center' }}>
                      <LayoutDashboard size={22} color="#2563eb" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a', marginBottom: 2 }}>
                        进入 Kernel 广场
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        搜索、筛选竞赛 Notebooks，对比历史版本与单篇即时归档
                      </div>
                    </div>
                  </Space>
                  <ChevronRight size={20} color="#94a3b8" />
                </div>
              </Card>
            </Col>

            {/* Quick Link Card 2: 本地归档库 */}
            <Col xs={24} md={12}>
              <Card
                className="dashboard-glow-card"
                hoverable
                onClick={() => navigate('/archives')}
                style={{
                  borderRadius: 14,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.02)',
                  cursor: 'pointer',
                }}
                styles={{ body: { padding: '20px 24px' } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Space size={14} align="center">
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: '#fdf4ff', display: 'grid', placeItems: 'center' }}>
                      <Archive size={22} color="#a855f7" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a', marginBottom: 2 }}>
                        本地已归档代码库
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        查看已下载的源代码、运行日志、输出文件与依赖清单 ({health?.archive?.total_archives ?? 0} 个版本)
                      </div>
                    </div>
                  </Space>
                  <ChevronRight size={20} color="#94a3b8" />
                </div>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
};

export default Dashboard;
