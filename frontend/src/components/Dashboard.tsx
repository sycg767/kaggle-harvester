import React, { useCallback, useEffect, useState } from 'react';
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
  App as AntApp,
} from 'antd';
import {
  Swords,
  Zap,
  Archive,
  RefreshCw,
  LayoutDashboard,
  Bell,
  Activity,
  ChevronRight,
  Database,
  HardDrive,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  api,
  type HealthStatus,
  type CompetitionInfo,
  type ArchiveStats,
} from '../api';
import { HARVESTER_EVENTS } from '../events';
import NotificationCenter from './NotificationCenter';
import SubmissionMonitorControl from './SubmissionMonitorControl';
import SimulationMonitorControl from './SimulationMonitorControl';
import AutoArchiveControl from './AutoArchiveControl';

const { Paragraph, Text } = Typography;

const formatBytes = (value = 0) => {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
};

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [competitionInfo, setCompetitionInfo] = useState<CompetitionInfo | null>(null);
  const [archiveStats, setArchiveStats] = useState<ArchiveStats | null>(null);
  const [currentCompetition, setCurrentCompetition] = useState<string>(() => {
    return localStorage.getItem('harvester.competition') || 'pokemon-tcg-ai-battle';
  });

  const loadDashboardData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);

    try {
      const [h, a] = await Promise.all([
        api.health().catch(() => null),
        api.getArchiveStats().catch(() => null),
      ]);
      if (h) {
        setHealth(h);
        const stored = localStorage.getItem('harvester.competition');
        const resolved = stored || h.active_competition?.competition || h.default_competition;
        if (resolved && !stored) {
          setCurrentCompetition(resolved);
        }
      }
      if (a) setArchiveStats(a);
    } catch (err: any) {
      if (!quiet) message.error(`加载仪表盘数据失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadDashboardData();
    const interval = setInterval(() => {
      void loadDashboardData(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [loadDashboardData]);

  useEffect(() => {
    let active = true;
    api.getCompetition(currentCompetition)
      .then((info) => {
        if (active) setCompetitionInfo(info);
      })
      .catch(() => {
        if (active) setCompetitionInfo(null);
      });
    return () => {
      active = false;
    };
  }, [currentCompetition]);

  useEffect(() => {
    const handleCompetitionChanged = (event: Event) => {
      const comp = (event as CustomEvent<string>).detail;
      if (comp) setCurrentCompetition(comp);
    };
    const handleDefaultChanged = (event: Event) => {
      const comp = (event as CustomEvent<string>).detail;
      if (comp) setCurrentCompetition(comp);
    };
    window.addEventListener(HARVESTER_EVENTS.competitionChanged, handleCompetitionChanged);
    window.addEventListener(HARVESTER_EVENTS.defaultCompetitionChanged, handleDefaultChanged);
    return () => {
      window.removeEventListener(HARVESTER_EVENTS.competitionChanged, handleCompetitionChanged);
      window.removeEventListener(HARVESTER_EVENTS.defaultCompetitionChanged, handleDefaultChanged);
    };
  }, []);

  const isSimulation = Boolean(
    competitionInfo?.is_simulation ||
    currentCompetition === 'pokemon-tcg-ai-battle' ||
    currentCompetition === 'kaggriculture'
  );

  const compTitle = competitionInfo?.title || currentCompetition;

  return (
    <div
      style={{
        padding: '12px 16px 36px 16px',
        maxWidth: 1440,
        margin: '0 auto',
        width: '100%',
        overflowX: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {loading && !health ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '80px 0', gap: 12 }}>
          <Spin size="large" />
          <span style={{ color: '#64748b', fontSize: 13 }}>正在加载指挥中心全景数据...</span>
        </div>
      ) : (
        <>
          {/* 1. Active Competition Status Banner */}
          <Card
            className="dashboard-glow-card dashboard-hero-card"
            style={{
              marginBottom: 20,
              borderRadius: 14,
              border: '1px solid #e2e8f0',
              background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.02)',
            }}
            styles={{ body: { padding: '20px 22px' } }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <Tag
                    color={isSimulation ? 'gold' : 'blue'}
                    style={{ margin: 0, fontWeight: 700, borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    {isSimulation ? <Swords size={13} /> : <Activity size={13} />}
                    {isSimulation ? '智能体对抗 / 模拟竞赛' : '标准赛题 / 预测建模'}
                  </Tag>
                  <Tag style={{ margin: 0, borderRadius: 6, background: '#f1f5f9', borderColor: '#e2e8f0', color: '#475569' }}>
                    Slug: <code>{currentCompetition}</code>
                  </Tag>
                  {competitionInfo?.team_count ? (
                    <Tag color="cyan" style={{ margin: 0, borderRadius: 6 }}>
                      参赛队伍: {competitionInfo.team_count} 队
                    </Tag>
                  ) : null}
                  {competitionInfo?.kernel_count ? (
                    <Tag color="geekblue" style={{ margin: 0, borderRadius: 6 }}>
                      开源代码: {competitionInfo.kernel_count} 篇
                    </Tag>
                  ) : null}
                </div>

                <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{compTitle}</span>
                  <a
                    href={`https://www.kaggle.com/competitions/${currentCompetition}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: '#2563eb', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    Kaggle 官网 ↗
                  </a>
                </div>

                <Text type="secondary" style={{ fontSize: 13, display: 'block', maxWidth: 760 }}>
                  {isSimulation
                    ? `当前处于模拟对战竞技态，后台支持针对我方双 Agent 自动化轮询天梯排位、对局流水与金银铜安全垫。`
                    : `当前处于标准竞赛模式，支持自动化监控我方队伍最新提交出分、高分开源 Notebooks 智能归档与依赖提取。`}
                </Text>
              </div>

              {/* Quick Jump Action Pills */}
              <Space wrap size={8}>
                {isSimulation ? (
                  <Button
                    type="primary"
                    icon={<Swords size={15} />}
                    onClick={() => navigate('/arena')}
                    style={{ background: '#d97706', borderColor: '#d97706', fontWeight: 600 }}
                  >
                    进入天梯对抗专页
                  </Button>
                ) : null}
                <Button
                  type={!isSimulation ? 'primary' : 'default'}
                  icon={<LayoutDashboard size={15} />}
                  onClick={() => navigate('/kernels')}
                  style={{ fontWeight: 600 }}
                >
                  浏览开源 Notebooks
                </Button>
                <Button
                  icon={<Archive size={15} />}
                  onClick={() => navigate('/archives')}
                  style={{ fontWeight: 600 }}
                >
                  本地已归档代码
                </Button>
              </Space>
            </div>
          </Card>

          {/* 2. Core Feature Control Hub (4 Main Modules) */}
          <div style={{ marginBottom: 24 }}>
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
                      <Tag color="volcano" style={{ margin: 0 }}>多通道通知</Tag>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>
                      通知中心
                    </div>
                    <Paragraph type="secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
                      支持飞书、企业微信、钉钉、Slack、ntfy 及邮件多通道推送配置与连通测试。
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
                      后台定时拉取队伍提交历史，实时解析最新 Public Leaderboard 分数与状态变动。
                    </Paragraph>
                  </div>
                  <div style={{ paddingTop: 10, borderTop: '1px solid #f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                    <SubmissionMonitorControl currentCompetition={currentCompetition} />
                  </div>
                </Card>
              </Col>

              {/* Module 3: 模拟对战监控 OR 开源广场快捷入口 (Context-Aware!) */}
              <Col xs={24} sm={12} xl={6}>
                {isSimulation ? (
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
                        智能体对战监控
                      </div>
                      <Paragraph type="secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
                        针对当前模拟赛追踪天梯积分、胜率对局流水与金银铜牌安全垫。
                      </Paragraph>
                    </div>
                    <div style={{ paddingTop: 10, borderTop: '1px solid #f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                      <SimulationMonitorControl currentCompetition={currentCompetition} />
                    </div>
                  </Card>
                ) : (
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
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eff6ff', display: 'grid', placeItems: 'center' }}>
                          <LayoutDashboard size={19} color="#2563eb" />
                        </div>
                        <Tag color="blue" style={{ margin: 0 }}>开源广场</Tag>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>
                        开源 Notebooks
                      </div>
                      <Paragraph type="secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
                        快速检索竞赛高赞与高分开源 Notebooks，对比历史版本与演化。
                      </Paragraph>
                    </div>
                    <div style={{ paddingTop: 10, borderTop: '1px solid #f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        type="default"
                        size="middle"
                        icon={<LayoutDashboard size={15} color="#2563eb" />}
                        onClick={() => navigate('/kernels')}
                        style={{ fontWeight: 500 }}
                      >
                        进入广场
                      </Button>
                    </div>
                  </Card>
                )}
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

          {/* 3. System Health & Storage Overview (Useful Data Cards instead of Duplicate Links) */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Space align="center" size={8}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#f1f5f9', display: 'grid', placeItems: 'center' }}>
                  <Database size={16} color="#475569" />
                </div>
                <span style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>
                  本地存储与运行态势
                </span>
              </Space>
            </div>

            <Row gutter={[16, 16]}>
              {/* Stat 1: 本地归档资产 */}
              <Col xs={24} md={8}>
                <Card
                  size="small"
                  className="dashboard-glow-card"
                  style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
                  styles={{ body: { padding: '16px 18px' } }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>本地已归档资产</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>
                          {archiveStats?.total_archives ?? health?.archive?.total_archives ?? 0}
                        </span>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>个版本</span>
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          ({archiveStats?.unique_kernels ?? health?.archive?.unique_kernels ?? 0} 个唯一 Kernel)
                        </span>
                      </div>
                    </div>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => navigate('/archives')}
                      style={{ padding: 0, fontWeight: 600 }}
                    >
                      查看归档 →
                    </Button>
                  </div>
                </Card>
              </Col>

              {/* Stat 2: 磁盘剩余容量 */}
              <Col xs={24} md={8}>
                <Card
                  size="small"
                  className="dashboard-glow-card"
                  style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
                  styles={{ body: { padding: '16px 18px' } }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>本地磁盘剩余</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 22, fontWeight: 800, color: archiveStats?.low_disk_space ? '#ef4444' : '#0f172a' }}>
                          {formatBytes(archiveStats?.disk_free_bytes ?? health?.archive?.disk_free_bytes ?? 0)}
                        </span>
                        {archiveStats?.low_disk_space ? (
                          <Tag color="error" style={{ margin: 0, fontSize: 11 }}>磁盘紧缺</Tag>
                        ) : (
                          <Tag color="success" style={{ margin: 0, fontSize: 11 }}>空间充裕</Tag>
                        )}
                      </div>
                    </div>
                    <HardDrive size={22} color="#94a3b8" style={{ marginTop: 2 }} />
                  </div>
                </Card>
              </Col>

              {/* Stat 3: 后端引擎状态 */}
              <Col xs={24} md={8}>
                <Card
                  size="small"
                  className="dashboard-glow-card"
                  style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
                  styles={{ body: { padding: '16px 18px' } }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>后端与 Kaggle CLI</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        {health?.ready ? (
                          <>
                            <CheckCircle2 size={16} color="#10b981" />
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>正常在线 · 巡检待命</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle size={16} color="#f59e0b" />
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b' }}>环境就绪中</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Button
                      type="link"
                      size="small"
                      icon={<RefreshCw size={13} />}
                      onClick={() => void loadDashboardData()}
                      style={{ padding: 0, fontWeight: 600 }}
                    >
                      检查
                    </Button>
                  </div>
                </Card>
              </Col>
            </Row>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
