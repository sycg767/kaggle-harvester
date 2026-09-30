import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Spin,
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

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [loading, setLoading] = useState(true);
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
