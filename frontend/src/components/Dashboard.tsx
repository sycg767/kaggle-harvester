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
  Select,
  Tooltip,
  App as AntApp,
} from 'antd';
import {
  Swords,
  Zap,
  Archive,
  LayoutDashboard,
  Bell,
  Activity,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Play,
  Send,
  Star,
  ChevronRight,
  TrendingUp,
  FolderOpen,
} from 'lucide-react';
import {
  api,
  type HealthStatus,
  type CompetitionInfo,
  type ArchiveStats,
  type EnteredCompetition,
} from '../api';
import {
  dispatchCompetitionChanged,
  dispatchDefaultCompetitionChanged,
  HARVESTER_EVENTS,
} from '../events';
import { buildEnteredCompetitionOptions, competitionDisplayName } from '../competitionOptions';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
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

const formatRelativeTime = (timeStr?: string | null) => {
  if (!timeStr) return '';
  try {
    const target = new Date(timeStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - target.getTime()) / 1000);
    if (diffSec < 0) {
      const futureSec = Math.abs(diffSec);
      if (futureSec < 60) return `${futureSec} 秒后`;
      if (futureSec < 3600) return `${Math.floor(futureSec / 60)} 分钟后`;
      return `${Math.floor(futureSec / 3600)} 小时后`;
    }
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
    return `${Math.floor(diffSec / 86400)} 天前`;
  } catch {
    return timeStr;
  }
};

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [competitionInfo, setCompetitionInfo] = useState<CompetitionInfo | null>(null);
  const [archiveStats, setArchiveStats] = useState<ArchiveStats | null>(null);
  const [enteredCompetitions, setEnteredCompetitions] = useState<EnteredCompetition[]>([]);
  const [currentCompetition, setCurrentCompetition] = useState<string>(() => {
    return localStorage.getItem('harvester.competition') || 'pokemon-tcg-ai-battle';
  });

  // Action loading states for 1-click execution
  const [runningAutoArchive, setRunningAutoArchive] = useState(false);
  const [runningSubmissionCheck, setRunningSubmissionCheck] = useState(false);
  const [runningSimulationCheck, setRunningSimulationCheck] = useState(false);
  const [testingNotifications, setTestingNotifications] = useState(false);
  const [togglingPin, setTogglingPin] = useState(false);
  const [refreshingComp, setRefreshingComp] = useState(false);

  const loadDashboardData = useCallback(async (quiet = false, forceRefresh = false) => {
    if (!quiet) setLoading(true);

    try {
      const [h, a, entered] = await Promise.all([
        api.health().catch(() => null),
        api.getArchiveStats().catch(() => null),
        getEnteredCompetitions(forceRefresh ? { refresh: true } : undefined).catch(() => []),
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
      if (entered) setEnteredCompetitions(entered);
      if (forceRefresh) {
        const curComp = localStorage.getItem('harvester.competition') || currentCompetition;
        if (curComp) {
          api.getCompetition(curComp, { refresh: true })
            .then((info) => {
              if (info) setCompetitionInfo(info);
            })
            .catch(() => null);
        }
      }
    } catch (err: any) {
      if (!quiet) message.error(`加载仪表盘数据失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [message, currentCompetition]);

  const handleRefreshCompetitionMeta = async () => {
    if (refreshingComp) return;
    setRefreshingComp(true);
    try {
      const info = await api.getCompetition(currentCompetition, { refresh: true });
      if (info) setCompetitionInfo(info);
      const items = await getEnteredCompetitions({ refresh: true });
      if (items) setEnteredCompetitions(items);
      message.success(`已从 Kaggle 同步最新赛事信息（当前 ${info.team_count ?? 0} 支队伍）`);
    } catch (err: any) {
      message.error(`同步失败: ${err.message}`);
    } finally {
      setRefreshingComp(false);
    }
  };

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

  const handleSelectCompetition = (newComp: string) => {
    if (!newComp || newComp === currentCompetition) return;
    setCurrentCompetition(newComp);
    localStorage.setItem('harvester.competition', newComp);
    dispatchCompetitionChanged(newComp);
    message.success(`已切换当前工作区至竞赛: ${newComp}`);
  };

  const togglePinActiveCompetition = async () => {
    const isPinned =
      health?.active_competition?.competition === currentCompetition &&
      health?.active_competition?.is_pinned;
    setTogglingPin(true);
    try {
      if (isPinned) {
        const res = await api.deleteActiveCompetition();
        setHealth((prev) => (prev ? { ...prev, active_competition: res } : null));
        message.success('已取消固定全站主攻赛事，恢复智能默认模式');
      } else {
        const res = await api.setActiveCompetition(currentCompetition);
        setHealth((prev) => (prev ? { ...prev, active_competition: res } : null));
        message.success(`已将「${currentCompetition}」设为全站主攻赛事`);
      }
      dispatchDefaultCompetitionChanged(currentCompetition);
    } catch (err: any) {
      message.error(`设置主攻赛事失败: ${err.message}`);
    } finally {
      setTogglingPin(false);
    }
  };

  // 1-Click Instant Action Handlers
  const handleRunAutoArchiveNow = async () => {
    setRunningAutoArchive(true);
    try {
      const snap = await api.runAutoArchive();
      message.success(
        `自动归档执行成功！检查 ${snap.status.checked_count} 个版本，命中 ${snap.status.matched_count} 个`
      );
      void loadDashboardData(true);
    } catch (err: any) {
      message.error(`自动归档执行失败: ${err.message}`);
    } finally {
      setRunningAutoArchive(false);
    }
  };

  const handleRunSubmissionCheckNow = async () => {
    setRunningSubmissionCheck(true);
    try {
      const snap = await api.runSubmissionMonitor();
      message.success(
        `出分检查完成！检查 ${snap.status.checked_count} 条提交，当前 ${snap.status.pending_count} 条等待出分`
      );
      void loadDashboardData(true);
    } catch (err: any) {
      message.error(`出分检查执行失败: ${err.message}`);
    } finally {
      setRunningSubmissionCheck(false);
    }
  };

  const handleRunSimulationCheckNow = async () => {
    setRunningSimulationCheck(true);
    try {
      const snap = await api.runSimulationMonitor();
      message.success(
        `对战战报更新完成！本次检查发现 ${snap.status.new_episodes_this_run || 0} 场新对局`
      );
      void loadDashboardData(true);
    } catch (err: any) {
      message.error(`对战检查失败: ${err.message}`);
    } finally {
      setRunningSimulationCheck(false);
    }
  };

  const handleTestNotifications = async () => {
    setTestingNotifications(true);
    try {
      const res = await api.testNotifications();
      if (res.success) {
        message.success(`通知通道测试成功！${res.channels.map((c) => c.channel).join('、')} 连接正常`);
      } else {
        const failed = res.channels.filter((c) => !c.success).map((c) => `${c.channel}: ${c.message}`).join('; ');
        message.warning(`部分通知通道连通异常: ${failed || '未配置任何有效通道'}`);
      }
    } catch (err: any) {
      message.error(`通知测试失败: ${err.message}`);
    } finally {
      setTestingNotifications(false);
    }
  };

  const isSimulation = Boolean(
    competitionInfo?.is_simulation ||
    currentCompetition === 'pokemon-tcg-ai-battle' ||
    currentCompetition === 'kaggriculture'
  );

  const compTitle = competitionInfo?.title || currentCompetition;
  const isPinned =
    health?.active_competition?.competition === currentCompetition &&
    health?.active_competition?.is_pinned;

  const competitionOptions = useMemo(() => {
    return buildEnteredCompetitionOptions(
      enteredCompetitions,
      [currentCompetition, health?.default_competition],
      {
        activeSlug: health?.active_competition?.competition,
        currentSlug: currentCompetition,
        excludeEnded: true,
      }
    );
  }, [enteredCompetitions, currentCompetition, health]);

  // Derived live metrics
  const simMonitorStatus = health?.simulation_monitor;
  const isSimCompMatch = Boolean(
    simMonitorStatus?.competition &&
    currentCompetition &&
    simMonitorStatus.competition === currentCompetition
  );
  const isSimMonitoringActive = Boolean(simMonitorStatus?.enabled ?? simMonitorStatus?.scheduler_alive);
  const activeAgent1 = isSimCompMatch ? simMonitorStatus?.agents?.[0] : undefined;
  const latestSubmission = health?.submission_monitor?.recent_items?.[0];
  const autoArchiveStatus = health?.auto_archive;

  return (
    <div
      style={{
        padding: '16px 20px 48px 20px',
        maxWidth: 1440,
        margin: '0 auto',
        width: '100%',
        overflowX: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {loading && !health ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '100px 0', gap: 12 }}>
          <Spin size="large" />
          <span style={{ color: '#64748b', fontSize: 13 }}>正在加载指挥中心全景态势数据...</span>
        </div>
      ) : (
        <>
          {/* =========================================================
              1. Interactive Active Competition Workspace Hero
              ========================================================= */}
          <Card
            className="dashboard-glow-card dashboard-hero-card"
            style={{
              marginBottom: 20,
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            }}
            styles={{ body: { padding: '20px 24px' } }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ flex: 1, minWidth: 320 }}>
                {/* Meta labels */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <Tag
                    color={isSimulation ? 'gold' : 'blue'}
                    style={{ margin: 0, fontWeight: 600, borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    {isSimulation ? <Swords size={13} /> : <Activity size={13} />}
                    {isSimulation ? '智能体博弈 · Simulation' : '标准赛题 · 预测建模'}
                  </Tag>
                  {competitionInfo?.team_count ? (
                    <Tag style={{ margin: 0, borderRadius: 4 }}>
                      {competitionInfo.team_count} 支队伍参赛
                    </Tag>
                  ) : null}
                  {competitionInfo?.kernel_count ? (
                    <Tag style={{ margin: 0, borderRadius: 4 }}>
                      {competitionInfo.kernel_count} 篇开源代码
                    </Tag>
                  ) : null}
                </div>

                {/* Primary Competition Switcher Bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <Select
                    value={currentCompetition}
                    onChange={handleSelectCompetition}
                    options={competitionOptions}
                    style={{ minWidth: 360, maxWidth: 560 }}
                    size="large"
                    showSearch
                    placeholder="切换当前竞赛..."
                  />
                  <Tooltip title={isPinned ? '已固定为主攻赛事（新设备默认展示）' : '设为全站主攻赛事'}>
                    <Button
                      type={isPinned ? 'primary' : 'default'}
                      icon={<Star size={14} fill={isPinned ? '#ffffff' : 'none'} />}
                      loading={togglingPin}
                      onClick={togglePinActiveCompetition}
                      style={{ height: 40, borderRadius: 8, fontWeight: 500 }}
                    >
                      {isPinned ? '已设为主攻' : '☆ 设为主攻'}
                    </Button>
                  </Tooltip>
                </div>

                <Text type="secondary" style={{ fontSize: 13, display: 'block', maxWidth: 760, lineHeight: 1.6 }}>
                  {isSimulation
                    ? '当前处于对抗竞技模式，后台实时追踪双 Agent 天梯胜率、对局流水战报与金银铜牌安全垫线。'
                    : '当前处于标准竞赛模式，支持自动化监控自提交最新出分，优先开源高分 Notebooks 智能归档与依赖提取。'}
                </Text>
              </div>

              {/* Direct Workspace Jump Action Pills */}
              <Space wrap size={10} style={{ alignSelf: 'center' }}>
                {isSimulation ? (
                  <Button
                    type="primary"
                    icon={<Swords size={15} />}
                    onClick={() => navigate('/arena')}
                    style={{ height: 38, borderRadius: 8, fontWeight: 600, background: '#d97706', borderColor: '#d97706' }}
                  >
                    天梯对抗专页
                  </Button>
                ) : null}
                <Button
                  type="primary"
                  icon={<LayoutDashboard size={15} />}
                  onClick={() => navigate('/kernels')}
                  style={{ height: 38, borderRadius: 8, fontWeight: 600 }}
                >
                  开源代码广场
                </Button>
                <Button
                  icon={<Archive size={15} />}
                  onClick={() => navigate('/archives')}
                  style={{ height: 38, borderRadius: 8, fontWeight: 600 }}
                >
                  本地归档仓库
                </Button>
              </Space>
            </div>
          </Card>

          {/* =========================================================
              2. Core Control Hub (4 Live Dynamic Cards)
              ========================================================= */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <Space align="center" size={8}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#e0f2fe', display: 'grid', placeItems: 'center' }}>
                  <Zap size={16} color="#0284c7" />
                </div>
                <span style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                  实时监控与自动化调度中枢
                </span>
                <Tag color="processing" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>
                  实时态势 · 一键直达
                </Tag>
              </Space>
            </div>

            <Row gutter={[16, 16]}>
              {/* Card 1: 智能自动归档 */}
              <Col xs={24} sm={12} xl={6}>
                <Card
                  className="dashboard-glow-card"
                  style={{
                    height: '100%',
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                  styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%' } }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 8, background: '#eff6ff', display: 'grid', placeItems: 'center' }}>
                        <Archive size={18} color="#1677ff" />
                      </div>
                      <Tag color={autoArchiveStatus?.running ? 'success' : 'default'} style={{ margin: 0, fontWeight: 500, borderRadius: 4 }}>
                        {autoArchiveStatus?.running ? '● 运行中' : '○ 已暂停'}
                      </Tag>
                    </div>

                    <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                      智能自动归档
                    </div>

                    {/* Live Metrics Box */}
                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: '#64748b' }}>累计已归档:</span>
                        <strong style={{ fontSize: 16, color: '#0f172a' }}>
                          {archiveStats?.total_archives ?? 0} <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>版本</span>
                        </strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                        <span>上次巡检:</span>
                        <span>{formatRelativeTime(autoArchiveStatus?.last_checked_at) || '尚未运行'}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#64748b' }}>
                        <span>命中高分:</span>
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>
                          {autoArchiveStatus?.matched_count ? `命中 ${autoArchiveStatus.matched_count} 个` : '0 个新版本'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Dual Action Controls */}
                  <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Button
                      size="small"
                      type="primary"
                      icon={<Play size={12} />}
                      loading={runningAutoArchive}
                      onClick={handleRunAutoArchiveNow}
                      style={{ borderRadius: 6, fontSize: 12, fontWeight: 500 }}
                    >
                      立即巡检
                    </Button>
                    <AutoArchiveControl currentCompetition={currentCompetition} buttonText="配置与历史" />
                  </div>
                </Card>
              </Col>

              {/* Card 2: 提交流水监控 */}
              <Col xs={24} sm={12} xl={6}>
                <Card
                  className="dashboard-glow-card"
                  style={{
                    height: '100%',
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                  styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%' } }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 8, background: '#f0fdf4', display: 'grid', placeItems: 'center' }}>
                        <Activity size={18} color="#16a34a" />
                      </div>
                      <Tag color={health?.submission_monitor?.running ? 'success' : 'default'} style={{ margin: 0, fontWeight: 500, borderRadius: 4 }}>
                        {health?.submission_monitor?.running ? '● 巡检中' : '○ 待命'}
                      </Tag>
                    </div>

                    <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                      提交流水监控
                    </div>

                    {/* Live Metrics Box */}
                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: '#64748b' }}>最新出分:</span>
                        <strong style={{ fontSize: 16, color: '#0f172a' }}>
                          {latestSubmission?.public_score != null ? (
                            <span style={{ color: '#16a34a' }}>{latestSubmission.public_score.toFixed(4)}</span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>暂无最新分</span>
                          )}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                        <span>待出分队列:</span>
                        <span style={{ color: health?.submission_monitor?.pending_count ? '#d97706' : '#64748b', fontWeight: 600 }}>
                          {health?.submission_monitor?.pending_count || 0} 条队列中
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#64748b' }}>
                        <span>上次检查:</span>
                        <span>{formatRelativeTime(health?.submission_monitor?.last_checked_at) || '尚未检查'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Dual Action Controls */}
                  <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Button
                      size="small"
                      type="primary"
                      icon={<Play size={12} />}
                      loading={runningSubmissionCheck}
                      onClick={handleRunSubmissionCheckNow}
                      style={{ borderRadius: 6, fontSize: 12, fontWeight: 500 }}
                    >
                      立即查分
                    </Button>
                    <SubmissionMonitorControl currentCompetition={currentCompetition} buttonText="配置与历史" />
                  </div>
                </Card>
              </Col>

              {/* Card 3: 模拟对战监控 OR 开源广场 */}
              <Col xs={24} sm={12} xl={6}>
                {isSimulation ? (
                  <Card
                    className="dashboard-glow-card"
                    style={{
                      height: '100%',
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                      background: '#ffffff',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                    styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%' } }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: '#fffbeb', display: 'grid', placeItems: 'center' }}>
                          <Swords size={18} color="#d97706" />
                        </div>
                        <Tag
                          color={isSimCompMatch && isSimMonitoringActive ? 'gold' : 'default'}
                          style={{ margin: 0, fontWeight: 500, borderRadius: 4 }}
                        >
                          {isSimCompMatch && isSimMonitoringActive ? '天梯对抗 (监控中)' : '天梯对抗 (待命)'}
                        </Tag>
                      </div>

                      <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                        智能体天梯对战
                      </div>

                      {/* Live Metrics Box */}
                      <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        {isSimCompMatch && activeAgent1 ? (
                          <>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 12, color: '#64748b' }}>天梯当前排位:</span>
                              <strong style={{ fontSize: 16, color: '#d97706' }}>
                                {activeAgent1.rank ? `Rank #${activeAgent1.rank}` : 'Rank #—'}
                              </strong>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                              <span>主 Agent 胜率:</span>
                              <span style={{ fontWeight: 600, color: '#0f172a' }}>
                                {activeAgent1.win_rate != null ? `${activeAgent1.win_rate}%` : '—'}
                                {activeAgent1.wins != null ? ` (${activeAgent1.wins}胜)` : ''}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#64748b' }}>
                              <span>铜牌安全垫:</span>
                              <span style={{ color: '#16a34a', fontWeight: 600 }}>
                                {activeAgent1.bronze_gap_score != null ? `+${activeAgent1.bronze_gap_score.toFixed(1)} 分` : '—'}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div style={{ textAlign: 'center', padding: '6px 0' }}>
                            <div style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>
                              {isSimCompMatch ? '暂无追踪的智能体数据' : '后台未开启此赛事的实时监控'}
                            </div>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                              点击下方「配置与战报」可开启巡检
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Dual Action Controls */}
                    <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Button
                        size="small"
                        type="primary"
                        icon={<Play size={12} />}
                        loading={runningSimulationCheck}
                        onClick={handleRunSimulationCheckNow}
                        style={{ borderRadius: 6, fontSize: 12, fontWeight: 500, background: '#d97706', borderColor: '#d97706' }}
                      >
                        抓取新战报
                      </Button>
                      <SimulationMonitorControl currentCompetition={currentCompetition} buttonText="配置与战报" />
                    </div>
                  </Card>
                ) : (
                  <Card
                    className="dashboard-glow-card"
                    style={{
                      height: '100%',
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                      background: '#ffffff',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                    styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%' } }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: '#eff6ff', display: 'grid', placeItems: 'center' }}>
                          <LayoutDashboard size={18} color="#1677ff" />
                        </div>
                        <Tag color="blue" style={{ margin: 0, borderRadius: 4 }}>开源高分</Tag>
                      </div>

                      <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                        开源 Notebooks
                      </div>

                      <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, color: '#64748b' }}>已发现代码:</span>
                          <strong style={{ fontSize: 16, color: '#0f172a' }}>
                            {competitionInfo?.kernel_count ?? '100+'} <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>篇</span>
                          </strong>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                          <span>榜单状态:</span>
                          <span style={{ color: '#1677ff', fontWeight: 600 }}>就绪可按分排序</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#64748b' }}>
                          <span>快速检索:</span>
                          <span style={{ color: '#64748b' }}>支持批量归档</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Button
                        type="primary"
                        size="small"
                        icon={<LayoutDashboard size={12} />}
                        onClick={() => navigate('/kernels')}
                        style={{ borderRadius: 6, fontWeight: 500 }}
                      >
                        进入广场
                      </Button>
                      <Button
                        size="small"
                        icon={<Archive size={12} />}
                        onClick={() => navigate('/archives')}
                        style={{ borderRadius: 6, fontWeight: 500 }}
                      >
                        已归档 ({archiveStats?.total_archives ?? 0})
                      </Button>
                    </div>
                  </Card>
                )}
              </Col>

              {/* Card 4: 多通道通知中心 */}
              <Col xs={24} sm={12} xl={6}>
                <Card
                  className="dashboard-glow-card"
                  style={{
                    height: '100%',
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                  styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%' } }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 8, background: '#fef2f2', display: 'grid', placeItems: 'center' }}>
                        <Bell size={18} color="#ef4444" />
                      </div>
                      <Tag color={health?.notifications?.worker_alive ? 'success' : 'default'} style={{ margin: 0, fontWeight: 500, borderRadius: 4 }}>
                        {health?.notifications?.worker_alive ? '● 通道正常' : '○ 待命中'}
                      </Tag>
                    </div>

                    <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                      通知服务中心
                    </div>

                    {/* Live Metrics Box */}
                    <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: '#64748b' }}>待发送队列:</span>
                        <strong style={{ fontSize: 16, color: '#0f172a' }}>
                          {health?.notifications?.pending_count || 0} <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>条</span>
                        </strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                        <span>上次投递:</span>
                        <span>{formatRelativeTime(health?.notifications?.last_sent_at) || '无近期投递'}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#64748b' }}>
                        <span>服务状态:</span>
                        <span style={{ color: health?.notifications?.last_error ? '#ef4444' : '#16a34a', fontWeight: 600 }}>
                          {health?.notifications?.last_error ? '异常报警' : '就绪待发'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Dual Action Controls */}
                  <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Button
                      size="small"
                      icon={<Send size={12} />}
                      loading={testingNotifications}
                      onClick={handleTestNotifications}
                      style={{ borderRadius: 6, fontSize: 12 }}
                    >
                      测试发送
                    </Button>
                    <NotificationCenter buttonText="通道配置" />
                  </div>
                </Card>
              </Col>
            </Row>
          </div>

          {/* =========================================================
              3. Infrastructure & Storage Guard Overview
              ========================================================= */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Space align="center" size={8}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#f1f5f9', display: 'grid', placeItems: 'center' }}>
                  <HardDrive size={16} color="#475569" />
                </div>
                <span style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>
                  本地存储与服务就绪态势
                </span>
              </Space>
            </div>

            <Row gutter={[16, 16]} style={{ display: 'flex', alignItems: 'stretch' }}>
              {/* Stat 1: 本地归档资产 */}
              <Col xs={24} md={8}>
                <Card
                  size="small"
                  className="dashboard-glow-card"
                  style={{
                    height: '100%',
                    minHeight: 116,
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                  styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' } }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>本地已归档资产</span>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => navigate('/archives')}
                        style={{ padding: 0, fontWeight: 600, color: '#1677ff', height: 'auto', lineHeight: 'normal' }}
                      >
                        查看归档 →
                      </Button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minHeight: 30 }}>
                      <span style={{ fontSize: 22, fontWeight: 700, color: '#0f172a' }}>
                        {archiveStats?.total_archives ?? health?.archive?.total_archives ?? 0}
                      </span>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>个版本</span>
                      <span style={{ fontSize: 12, color: '#64748b' }}>
                        ({archiveStats?.unique_kernels ?? health?.archive?.unique_kernels ?? 0} 个 Kernel)
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, paddingTop: 8, borderTop: '1px solid #f8fafc' }}>
                    占用: {formatBytes(archiveStats?.total_size_bytes ?? 0)} · 跨 {archiveStats?.unique_competitions ?? 1} 场竞赛
                  </div>
                </Card>
              </Col>

              {/* Stat 2: 磁盘剩余容量 */}
              <Col xs={24} md={8}>
                <Card
                  size="small"
                  className="dashboard-glow-card"
                  style={{
                    height: '100%',
                    minHeight: 116,
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                  styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' } }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>本地磁盘可用容量</span>
                      <HardDrive size={16} color="#94a3b8" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minHeight: 30 }}>
                      <span style={{ fontSize: 22, fontWeight: 700, color: archiveStats?.low_disk_space ? '#ef4444' : '#0f172a' }}>
                        {formatBytes(archiveStats?.disk_free_bytes ?? health?.archive?.disk_free_bytes ?? 0)}
                      </span>
                      {archiveStats?.low_disk_space ? (
                        <Tag color="error" style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>磁盘紧缺</Tag>
                      ) : (
                        <Tag color="success" style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>空间充裕</Tag>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, paddingTop: 8, borderTop: '1px solid #f8fafc' }}>
                    保护阈值: 2.0 GB · 低于阈值将暂停自动下载
                  </div>
                </Card>
              </Col>

              {/* Stat 3: 后端引擎状态 */}
              <Col xs={24} md={8}>
                <Card
                  size="small"
                  className="dashboard-glow-card"
                  style={{
                    height: '100%',
                    minHeight: 116,
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                  styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' } }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>后端与 Kaggle CLI</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 30 }}>
                      {health?.ready ? (
                        <>
                          <CheckCircle2 size={18} color="#16a34a" />
                          <span style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>正常在线 · 就绪</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={18} color="#f59e0b" />
                          <span style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>环境就绪中</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, paddingTop: 8, borderTop: '1px solid #f8fafc' }}>
                    CLI: {health?.kaggle_cli ? '已就绪' : '未检测到'} · Token: {health?.token_configured ? '已配置' : '未配置'}
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
