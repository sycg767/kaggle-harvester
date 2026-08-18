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
  List,
  Empty,
  App as AntApp,
} from 'antd';
import {
  Swords,
  Trophy,
  Bot,
  Zap,
  TrendingUp,
  Archive,
  ExternalLink,
  ArrowRight,
  RefreshCw,
  Sparkles,
  LayoutDashboard,
} from 'lucide-react';
import {
  api,
  type ScoredKernel,
  type HealthStatus,
  type SimulationMonitorSnapshot,
} from '../api';
import SimulationMonitorControl from './SimulationMonitorControl';
import NotificationCenter from './NotificationCenter';

const { Text, Title } = Typography;

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [simSnapshot, setSimSnapshot] = useState<SimulationMonitorSnapshot | null>(null);
  const [topKernels, setTopKernels] = useState<ScoredKernel[]>([]);
  const [currentCompetition, setCurrentCompetition] = useState<string>('pokemon-tcg-ai-battle');

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

      // Fetch top kernels for active competition
      const activeComp = localStorage.getItem('harvester.competition') || 'biohub-cell-tracking-during-development';
      try {
        const kData = await api.listKernels({
          competition: activeComp,
          sort_by: 'scoreAscending',
          page_size: 5,
        });
        setTopKernels((kData.items || []).slice(0, 5));
      } catch {
        // Fallback or quiet ignore
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

  // Compute key stats for Pokemon TCG
  const p46 = agents.find((a) => a.submission_id === 55565346) || agents[0];
  const p31 = agents.find((a) => a.submission_id === 55555162) || agents[1];

  const formatScore = (val?: number | null) => (val !== undefined && val !== null ? val.toFixed(1) : '—');

  return (
    <div style={{ padding: '4px 0 32px 0', maxWidth: 1400, margin: '0 auto' }}>
      {/* 1. Header Hero Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)',
          borderRadius: 16,
          padding: '24px 28px',
          color: '#fff',
          marginBottom: 20,
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.25)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle glowing orb */}
        <div
          style={{
            position: 'absolute',
            top: -40,
            right: -40,
            width: 200,
            height: 200,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, rgba(56, 189, 248, 0) 70%)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Sparkles size={20} color="#38bdf8" />
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: '#38bdf8', textTransform: 'uppercase' }}>
                Kaggle Harvester Command Center
              </span>
            </div>
            <Title level={3} style={{ color: '#f8fafc', margin: 0, fontWeight: 800, fontSize: 22 }}>
              🏆 竞赛作战指挥中心
            </Title>
            <Text style={{ color: '#94a3b8', fontSize: 13 }}>
              全天候模拟对抗对战监控、高分 Notebooks 猎手与微信智能管家中枢
            </Text>
          </div>

          <Space size={10} wrap>
            <Button
              icon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />}
              loading={refreshing}
              onClick={() => loadDashboardData(true)}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                borderColor: 'rgba(255, 255, 255, 0.15)',
                color: '#f1f5f9',
              }}
            >
              刷新大盘
            </Button>
            <SimulationMonitorControl currentCompetition={currentCompetition} />
          </Space>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '80px 0' }}>
          <Spin size="large" tip="正在加载指挥中心全景数据..." />
        </div>
      ) : (
        <>
          {/* 2. Top Row: Pokemon TCG Live Battle Card + WeChat ClawBot Hub */}
          <Row gutter={[18, 18]} style={{ marginBottom: 20 }}>
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
                bodyStyle={{ padding: '20px 22px' }}
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
                        竞赛状态: 活跃模拟对战中 · 实时 ELO 积分
                      </Text>
                    </div>
                  </Space>

                  <SimulationMonitorControl currentCompetition={currentCompetition} />
                </div>

                {/* Dual Agents Quick Stats */}
                <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
                  {/* Agent p46 */}
                  <Col xs={24} sm={12}>
                    <div
                      style={{
                        background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                        border: '1px solid #bbf7d0',
                        borderRadius: 10,
                        padding: '12px 16px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Tag color="green" style={{ fontWeight: 700, margin: 0 }}>
                          Agent p46 (#55565346)
                        </Tag>
                        <Tag color="orange" icon={<Trophy size={11} style={{ marginRight: 2 }} />}>
                          🥉 铜牌线内
                        </Tag>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 24, fontWeight: 900, color: '#166534' }}>
                          {formatScore(p46?.score || p46?.public_score)}
                        </span>
                        <span style={{ fontSize: 12, color: '#15803d' }}>
                          分 (第 {p46?.rank || 580} 名)
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#166534', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span>胜率: {p46?.win_rate?.toFixed(1) || '52.9'}% ({p46?.wins || 37}胜/{p46?.losses || 33}负)</span>
                        <span style={{ fontWeight: 700 }}>安全垫: +{p46?.bronze_gap_score ?? '19.0'}分</span>
                      </div>
                    </div>
                  </Col>

                  {/* Agent p31 */}
                  <Col xs={24} sm={12}>
                    <div
                      style={{
                        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: '12px 16px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Tag color="purple" style={{ fontWeight: 700, margin: 0 }}>
                          Agent p31 (#55555162)
                        </Tag>
                        <Tag color="default">
                          距铜牌 -62.4分
                        </Tag>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 24, fontWeight: 900, color: '#334155' }}>
                          {formatScore(p31?.score || p31?.public_score)}
                        </span>
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          分 (第 {p31?.rank || 580} 名)
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#475569', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span>胜率: {p31?.win_rate?.toFixed(1) || '57.4'}% ({p31?.wins || 35}胜/{p31?.losses || 26}负)</span>
                        <span style={{ color: '#0284c7', fontWeight: 600 }}>最新: vs DaoHe Liu 胜 +3.9</span>
                      </div>
                    </div>
                  </Col>
                </Row>

                {/* Thresholds Waterline Indicator */}
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', border: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                    <span style={{ fontWeight: 600 }}>奖牌线切分 (总计 {thresholds?.total_teams || 6807} 支参赛队)</span>
                    <Space size={12}>
                      <span style={{ color: '#ca8a04' }}>🥇 金: {thresholds?.gold_cutoff_score || 1131.9}分</span>
                      <span style={{ color: '#475569' }}>🥈 银: {thresholds?.silver_cutoff_score || 917.4}分</span>
                      <span style={{ color: '#d97706', fontWeight: 700 }}>🥉 铜: {thresholds?.bronze_cutoff_score || 839.1}分</span>
                    </Space>
                  </div>
                  <Progress
                    percent={88}
                    showInfo={false}
                    strokeColor={{
                      '0%': '#3b82f6',
                      '70%': '#d97706',
                      '90%': '#eab308',
                      '100%': '#22c55e',
                    }}
                    size={['100%', 8]}
                  />
                </div>
              </Card>
            </Col>

            {/* Right: WeChat ClawBot & System Monitor Hub */}
            <Col xs={24} lg={9}>
              <Card
                style={{
                  height: '100%',
                  borderRadius: 14,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.03)',
                }}
                bodyStyle={{ padding: '20px 22px' }}
              >
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

                  <Tag color={clawbot?.enabled ? 'success' : 'default'} style={{ margin: 0, fontWeight: 700 }}>
                    {clawbot?.enabled ? '🟢 在线' : '⚪ 未就绪'}
                  </Tag>
                </div>

                {/* Model & Config Details */}
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', marginBottom: 12, border: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: '#64748b' }}>大模型引擎:</span>
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>{clawbot?.model || 'deepseek-v4-flash-0731'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: '#64748b' }}>服务商:</span>
                    <span style={{ color: '#334155' }}>{clawbot?.provider || 'TokenRhythm Studio'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#64748b' }}>后台巡检:</span>
                    <span style={{ color: '#16a34a', fontWeight: 600 }}>每 10 分钟自动检查对局</span>
                  </div>
                </div>

                {/* WeChat Commands Quick List */}
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>📱 手机微信直接发送指令：</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <Tag color="blue">战况</Tag>
                    <Tag color="gold">分数</Tag>
                    <Tag color="purple">排名</Tag>
                    <Tag color="cyan">刷新</Tag>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    磁盘空间: {health?.archive ? `${(health.archive.disk_free_bytes / 1024 / 1024 / 1024).toFixed(1)} GB 可用` : '正常'}
                  </Text>
                  <NotificationCenter />
                </div>
              </Card>
            </Col>
          </Row>

          {/* 3. Bottom Row: High-Scoring Notebooks Top 5 & Quick Action Hub */}
          <Row gutter={[18, 18]}>
            {/* Left: High-Scoring Breakthrough Notebooks */}
            <Col xs={24} lg={15}>
              <Card
                style={{
                  borderRadius: 14,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.03)',
                }}
                bodyStyle={{ padding: '20px 22px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <Space align="center" size={8}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eff6ff', display: 'grid', placeItems: 'center' }}>
                      <TrendingUp size={18} color="#2563eb" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                        热门高分 Notebooks 猎手 (Top 5)
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        实时关注公开高分开源方案与基线突破
                      </Text>
                    </div>
                  </Space>

                  <Button
                    type="primary"
                    size="small"
                    icon={<ArrowRight size={14} />}
                    onClick={() => navigate('/kernels')}
                    style={{ fontWeight: 600 }}
                  >
                    前往 Kernel 广场
                  </Button>
                </div>

                {topKernels.length === 0 ? (
                  <Empty description="暂无高分 Notebook 数据，请在 Kernel 广场选择竞赛并抓取。" />
                ) : (
                  <List
                    size="small"
                    dataSource={topKernels}
                    renderItem={(k, idx) => (
                      <List.Item
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          marginBottom: 6,
                          background: idx === 0 ? '#f0f9ff' : '#f8fafc',
                          border: idx === 0 ? '1px solid #bae6fd' : '1px solid #f1f5f9',
                        }}
                        actions={[
                          <Button
                            key="view"
                            type="text"
                            size="small"
                            icon={<ExternalLink size={13} />}
                            href={`https://www.kaggle.com/code/${k.ref}`}
                            target="_blank"
                          >
                            Kaggle
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          avatar={
                            <div
                              style={{
                                width: 26,
                                height: 26,
                                borderRadius: '50%',
                                background: idx === 0 ? '#0284c7' : '#94a3b8',
                                color: '#fff',
                                display: 'grid',
                                placeItems: 'center',
                                fontWeight: 800,
                                fontSize: 12,
                              }}
                            >
                              {idx + 1}
                            </div>
                          }
                          title={
                            <Space size={8}>
                              <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                                {k.title || k.ref}
                              </span>
                              {k.public_score !== null && (
                                <Tag color={idx === 0 ? 'cyan' : 'blue'} style={{ fontWeight: 700 }}>
                                  {k.public_score?.toFixed(4)}
                                </Tag>
                              )}
                            </Space>
                          }
                          description={
                            <Space size={12} style={{ fontSize: 12, color: '#64748b' }}>
                              <span>👤 {k.author}</span>
                              <span>⭐️ {k.total_votes || 0} 赞</span>
                              <span>🕒 {k.last_run_time ? k.last_run_time.slice(0, 10) : '近期'}</span>
                            </Space>
                          }
                        />
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>

            {/* Right: Quick Command Cockpit */}
            <Col xs={24} lg={9}>
              <Card
                style={{
                  height: '100%',
                  borderRadius: 14,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.03)',
                }}
                bodyStyle={{ padding: '20px 22px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fdf4ff', display: 'grid', placeItems: 'center' }}>
                    <Zap size={18} color="#a855f7" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                      快速操控中心
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      一键直达核心竞赛功能
                    </Text>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Button
                    block
                    size="large"
                    icon={<LayoutDashboard size={16} />}
                    onClick={() => navigate('/kernels')}
                    style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, height: 46 }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>进入 Kernel 广场</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>搜索、筛选及批量下载 Notebooks</div>
                    </div>
                  </Button>

                  <Button
                    block
                    size="large"
                    icon={<Archive size={16} />}
                    onClick={() => navigate('/archives')}
                    style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, height: 46 }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>本地已归档代码库</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>查看已下载的源代码、依赖与输出</div>
                    </div>
                  </Button>
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
