import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Spin,
  Alert,
  Button,
  Card,
  List,
  App as AntApp,
} from 'antd';
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
import CompetitionHeroBanner from './dashboard/CompetitionHeroBanner';
import SchedulerCards from './dashboard/SchedulerCards';
import StorageStatusCards from './dashboard/StorageStatusCards';
import { latestCompetitionSubmission } from './dashboard/dashboardUtils';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<string>();
  const [refreshError, setRefreshError] = useState('');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [competitionInfo, setCompetitionInfo] = useState<CompetitionInfo | null>(null);
  const [archiveStats, setArchiveStats] = useState<ArchiveStats | null>(null);
  const [enteredCompetitions, setEnteredCompetitions] = useState<EnteredCompetition[]>([]);
  const [currentCompetition, setCurrentCompetition] = useState<string>(() => {
    return localStorage.getItem('harvester.competition') || '';
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
      setRefreshError([!h && '服务状态刷新失败', !a && '归档统计刷新失败'].filter(Boolean).join('；'));
      if (h) {
        setLastLoadedAt(new Date().toLocaleString('zh-CN'));
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
    setCompetitionInfo(null);
    if (!currentCompetition) return;
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
    if (health?.simulation_monitor?.competition !== currentCompetition) {
      message.warning('请先为当前赛事配置对战监控');
      return;
    }
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
    competitionInfo?.tags?.some((t) => t.toLowerCase().includes('simulation')) ||
    currentCompetition === 'pokemon-tcg-ai-battle' ||
    currentCompetition === 'kaggriculture' ||
    currentCompetition.toLowerCase().includes('simulation')
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
  const isSimMonitoringActive = Boolean(simMonitorStatus?.enabled || simMonitorStatus?.running || simMonitorStatus?.next_run_at);
  const activeAgent1 = isSimCompMatch ? simMonitorStatus?.agents?.[0] : undefined;
  const latestSubmission = latestCompetitionSubmission(health?.submission_monitor?.recent_items, currentCompetition);
  const autoArchiveStatus = health?.auto_archive;

  const issues = [
    refreshError,
    health && !health.ready ? '后端环境未就绪，请检查 Kaggle CLI 与访问凭据。' : '',
    health?.auto_archive?.last_error ? `全局归档：${health.auto_archive.last_error}` : '',
    health?.submission_monitor?.last_error ? `全局查分：${health.submission_monitor.last_error}` : '',
    health?.notifications?.last_error ? `全局通知：${health.notifications.last_error}` : '',
    isSimCompMatch && simMonitorStatus?.last_error ? `本赛事对战：${simMonitorStatus.last_error}` : '',
    archiveStats?.low_disk_space ? '服务器磁盘容量不足，请检查归档存储。' : '',
  ].filter(Boolean);
  const currentArchiveResults = autoArchiveStatus?.recent_results?.filter(item => item.competition === currentCompetition) || [];

  return (
    <div
      className="dashboard-container"
      style={{
        maxWidth: 1380,
        margin: '0 auto',
        width: '100%',
        overflowX: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {loading && !health ? (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '40vh', padding: '60px 0', gap: 12 }}>
          <Spin size="large" />
          <span style={{ color: '#64748b', fontSize: 13 }}>正在读取当前赛事与任务状态...</span>
        </div>
      ) : (
        <>
          <CompetitionHeroBanner
            isSimulation={isSimulation}
            competitionInfo={competitionInfo}
            currentCompetition={currentCompetition}
            onSelectCompetition={handleSelectCompetition}
            competitionOptions={competitionOptions}
            isPinned={Boolean(isPinned)}
            togglingPin={togglingPin}
            onTogglePin={togglePinActiveCompetition}
            onNavigate={navigate}
          />

          <section style={{ marginBottom: 24, display: 'grid', gap: 12 }} aria-label="当前赛事动态与待处理事项">
            <Alert
              type={issues.length ? 'warning' : health ? 'info' : 'error'} showIcon
              message={issues.length ? '需要关注的事项' : health ? '最近状态摘要' : '尚未取得服务状态'}
              description={<>
                <div>页面最近取得服务状态：{lastLoadedAt || '尚无记录'}。任务采集时间见下方；页面刷新不代表 Kaggle 数据已更新。</div>
                {issues.map(issue => <div key={issue}>{issue}</div>)}
              </>}
              action={<Button size="small" loading={loading} onClick={() => void loadDashboardData()}>重试刷新</Button>}
            />
            <Card size="small" title="当前赛事 · 最新提交与归档结果">
              <p style={{ color: '#64748b' }}>来源：后台监控最近记录，仅展示明确属于 {currentCompetition || '当前赛事'} 的条目；不是完整历史。</p>
              {latestSubmission ? <div style={{ marginBottom: 12 }}>
                <strong>提交 {latestSubmission.ref}：{latestSubmission.description || '无描述'}</strong>
                <div>状态：{latestSubmission.status || '未知'} · 公开分：{latestSubmission.public_score_display || latestSubmission.public_score?.toString() || '尚无分数'}</div>
                <div>提交时间：{latestSubmission.date || '未知'} · 出分时间：{latestSubmission.scored_at || '尚无记录'}</div>
                {latestSubmission.error_description && <div style={{ color: '#cf1322' }}>{latestSubmission.error_description}</div>}
              </div> : <p>最近监控摘要中暂无本赛事提交，可在下方「提交流水监控」检查配置与历史。</p>}
              <List size="small" dataSource={currentArchiveResults.slice(0, 5)} locale={{ emptyText: '最近归档摘要中暂无本赛事记录' }} renderItem={item => <List.Item>
                <span>{item.ref}{item.version_number != null ? ` · v${item.version_number}` : ''}：{item.status === 'archived' ? '已归档' : item.status === 'skipped' ? '已跳过' : '归档失败'}{item.error ? ` · ${item.error}` : ''}</span>
              </List.Item>} />
              <Button type="link" onClick={() => navigate('/archives')}>查看服务器归档</Button>
            </Card>
          </section>

          <SchedulerCards
            currentCompetition={currentCompetition}
            archiveStats={archiveStats}
            autoArchiveStatus={autoArchiveStatus}
            runningAutoArchive={runningAutoArchive}
            onRunAutoArchiveNow={handleRunAutoArchiveNow}
            health={health}
            latestSubmission={latestSubmission}
            runningSubmissionCheck={runningSubmissionCheck}
            onRunSubmissionCheckNow={handleRunSubmissionCheckNow}
            isSimulation={isSimulation}
            isSimCompMatch={isSimCompMatch}
            isSimMonitoringActive={isSimMonitoringActive}
            activeAgent1={activeAgent1}
            runningSimulationCheck={runningSimulationCheck}
            onRunSimulationCheckNow={handleRunSimulationCheckNow}
            competitionInfo={competitionInfo}
            testingNotifications={testingNotifications}
            onTestNotifications={handleTestNotifications}
            onNavigate={navigate}
          />

          <StorageStatusCards
            archiveStats={archiveStats}
            health={health}
            onNavigate={navigate}
          />
        </>
      )}
    </div>
  );
};

export default Dashboard;
