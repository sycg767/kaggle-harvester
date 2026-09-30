import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  App as AntApp,
  Badge,
  Button,
  Spin,
  Tooltip,
  Typography,
} from 'antd';
import {
  Archive,
  Activity,
  Database,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Star,
  Swords,
  Trophy,
  WifiOff,
} from 'lucide-react';
import { api, apiAuth, ApiError, describeConnectionError, type ArchiveStats, type CompetitionInfo, type EnteredCompetition, type HealthStatus } from '../api';
import { dispatchCompetitionChanged, HARVESTER_EVENTS } from '../events';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import kaggleLogo from '../assets/kaggle-logo.svg';
import {
  type NavItem,
  formatBytes,
  RuntimeDiagnosticsDrawer,
  GlobalCompetitionSwitcherModal,
  ApiKeyAuthModal,
  MobileNavDrawer,
} from './layout';

const AppLayout: React.FC = () => {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [archiveStats, setArchiveStats] = useState<ArchiveStats | null>(null);
  const [competitionInfo, setCompetitionInfo] = useState<CompetitionInfo | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendOnline, setBackendOnline] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const consecutiveFailuresRef = useRef(0);
  const loadedRef = useRef(false);
  const healthRequestRef = useRef<Promise<HealthStatus | null> | null>(null);
  const lastHealthErrorRef = useRef<unknown>(null);
  const [connectionError, setConnectionError] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [rememberApiKey, setRememberApiKey] = useState(true);
  const [authChecking, setAuthChecking] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('harvester.sidebarCollapsed') === 'true',
  );
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [enteredCompetitions, setEnteredCompetitions] = useState<EnteredCompetition[]>([]);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768,
  );
  const shortcutLabel = /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K';

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // All triggers share one request and one failure count, including initial load and retries.
  const loadData = useCallback((isManualRetry = false): Promise<HealthStatus | null> => {
    if (healthRequestRef.current) return healthRequestRef.current;
    const refreshCompetition = !loadedRef.current || isManualRetry;
    if (refreshCompetition) setLoading(true);
    setLoadingSlow(false);
    const slowTimer = window.setTimeout(() => setLoadingSlow(true), 4000);
    const pending = (async () => {
      try {
        const status = await api.health({ timeoutMs: 15_000 });
        setHealth(status);
        setBackendOnline(true);
        setIsReconnecting(false);
        setConnectionError('');
        setAuthRequired(false);
        lastHealthErrorRef.current = null;
        consecutiveFailuresRef.current = 0;
        loadedRef.current = true;
        setHasLoadedOnce(true);
        setArchiveStats(status.archive);
        if (refreshCompetition) {
          const activeCompetition =
            localStorage.getItem('harvester.competition') ||
            status.active_competition?.competition ||
            status.default_competition;
          if (activeCompetition && !localStorage.getItem('harvester.competition')) {
            localStorage.setItem('harvester.competition', activeCompetition);
          }
          void api.getCompetition(activeCompetition)
            .then((comp) => { if (comp) setCompetitionInfo(comp); })
            .catch(() => null);
        }
        return status;
      } catch (error) {
        lastHealthErrorRef.current = error;
        setConnectionError(describeConnectionError(error));
        consecutiveFailuresRef.current += 1;
        const authFailed = error instanceof ApiError && error.status === 401;
        if (authFailed) { setAuthOpen(true); setAuthRequired(true); }
        if (!loadedRef.current || authFailed) {
          setBackendOnline(false);
        } else {
          setIsReconnecting(true);
          if (consecutiveFailuresRef.current >= 3) setBackendOnline(false);
        }
        return null;
      } finally {
        window.clearTimeout(slowTimer);
        healthRequestRef.current = null;
        setLoading(false);
        setLoadingSlow(false);
      }
    })();
    healthRequestRef.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    const handleDefaultChanged = () => {
      void loadData(true);
    };
    window.addEventListener(HARVESTER_EVENTS.defaultCompetitionChanged, handleDefaultChanged);
    return () =>
      window.removeEventListener(HARVESTER_EVENTS.defaultCompetitionChanged, handleDefaultChanged);
  }, [loadData]);

  useEffect(() => {
    const requireAuth = () => { setAuthRequired(true); setAuthOpen(true); };
    window.addEventListener('harvester:auth-required', requireAuth);
    return () => window.removeEventListener('harvester:auth-required', requireAuth);
  }, []);

  const submitApiKey = async () => {
    if (!apiKey.trim()) return;
    setAuthChecking(true);
    try {
      // Finish a request using the previous credentials before validating the new key.
      await healthRequestRef.current;
      apiAuth.setKey(apiKey, rememberApiKey);
      const status = await loadData(true);
      if (!status) throw lastHealthErrorRef.current;
      setAuthOpen(false);
      setApiKey('');
      message.success(rememberApiKey ? '访问密钥已记住' : '访问密钥验证成功');
    } catch (error) {
      message.error(describeConnectionError(error));
    } finally {
      setAuthChecking(false);
    }
  };

  const forgetApiKey = () => {
    apiAuth.clearKey();
    setRuntimeOpen(false);
    setAuthRequired(true);
    setApiKey('');
    setAuthOpen(true);
    message.success('已清除当前浏览器保存的访问密钥');
  };

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const checkHealth = async () => {
      await loadData();
      if (stopped) return;
      // Schedule from completion so a slow request never overlaps the next poll.
      const failures = consecutiveFailuresRef.current;
      const authFailed = lastHealthErrorRef.current instanceof ApiError &&
        lastHealthErrorRef.current.status === 401;
      timer = window.setTimeout(() => void checkHealth(),
        failures > 0 && failures < 3 && !authFailed ? 6_000 : 30_000);
    };
    void checkHealth();
    const handleOnline = () => { void loadData(); };
    const handleFocus = () => {
      if (consecutiveFailuresRef.current > 0) void loadData();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadData]);

  useEffect(() => {
    const handleCompetitionChanged = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      const slug = customEvent.detail;
      if (!slug) return;
      void api
        .getCompetition(slug)
        .then(setCompetitionInfo)
        .catch(() => setCompetitionInfo(null));
    };
    window.addEventListener(HARVESTER_EVENTS.competitionChanged, handleCompetitionChanged);
    return () =>
      window.removeEventListener(HARVESTER_EVENTS.competitionChanged, handleCompetitionChanged);
  }, []);

  useEffect(() => {
    const refreshArchiveStats = () => {
      void api.getArchiveStats().then(setArchiveStats).catch(() => undefined);
    };
    window.addEventListener(HARVESTER_EVENTS.archivesChanged, refreshArchiveStats);
    return () => window.removeEventListener(HARVESTER_EVENTS.archivesChanged, refreshArchiveStats);
  }, []);

  useEffect(() => {
    if (switcherOpen) {
      void getEnteredCompetitions().then(setEnteredCompetitions).catch(() => []);
    }
  }, [switcherOpen]);

  const handleSelectGlobalCompetition = (slug: string, navigateToKernels = false) => {
    if (!slug) return;
    const cleanSlug = slug.trim();
    localStorage.setItem('harvester.competition', cleanSlug);
    localStorage.setItem('harvester.arenaCompetition', cleanSlug);
    dispatchCompetitionChanged(cleanSlug);
    void api.getCompetition(cleanSlug).then((comp) => {
      if (comp) {
        setCompetitionInfo(comp);
        message.success(`已切换全站工作区赛事为：${comp.title}`);
      }
    }).catch(() => null);
    setSwitcherOpen(false);
    if (navigateToKernels) {
      navigate('/kernels');
    }
  };

  const openCompetitionSwitcher = useCallback(() => {
    setSwitcherOpen(true);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSwitcherOpen((curr) => !curr);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const currentKey: NavItem['key'] = location.pathname.startsWith('/archives')
    ? 'archives'
    : location.pathname.startsWith('/kernels')
    ? 'kernels'
    : location.pathname.startsWith('/arena')
    ? 'arena'
    : 'dashboard';

  const runtimeErrors = [
    health?.auto_archive.last_error,
    health?.submission_monitor?.last_error,
    health?.notifications?.last_error,
  ].filter(Boolean) as string[];
  const runtimeIssueCount = runtimeErrors.length + (health?.archive.low_disk_space ? 1 : 0);

  const navItems: NavItem[] = [
    { key: 'dashboard', label: '竞赛工作台', icon: <Activity size={17} /> },
    { key: 'arena', label: '天梯对抗', icon: <Swords size={17} /> },
    { key: 'kernels', label: '代码发现', icon: <LayoutDashboard size={17} /> },
    {
      key: 'archives',
      label: '归档与研究',
      icon: <Archive size={17} />,
      badge: archiveStats?.total_archives,
    },
  ];

  const handleNavigation = (key: NavItem['key']) => {
    if (key === 'dashboard') navigate('/dashboard');
    else if (key === 'arena') navigate('/arena');
    else if (key === 'kernels') navigate('/kernels');
    else navigate('/archives');
    setMobileNavOpen(false);
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      localStorage.setItem('harvester.sidebarCollapsed', String(!current));
      return !current;
    });
  };

  const renderNavigation = (mobile = false) => (
    <nav className="newapi-nav" aria-label="功能导航">
      <div className="newapi-nav-group-label">常规</div>
      {navItems.map((item) => (
        <Tooltip
          key={item.key}
          title={!mobile && sidebarCollapsed ? item.label : undefined}
          placement="right"
        >
          <button
            type="button"
            className={`newapi-nav-item${currentKey === item.key ? ' is-active' : ''}`}
            aria-current={currentKey === item.key ? 'page' : undefined}
            onClick={() => handleNavigation(item.key)}
          >
            <span className="newapi-nav-icon">{item.icon}</span>
            <span className="newapi-nav-label">{item.label}</span>
            {!!item.badge && <span className="newapi-nav-badge">{item.badge}</span>}
          </button>
        </Tooltip>
      ))}
    </nav>
  );

  const renderArchiveSummary = () =>
    archiveStats && (
      <div className="newapi-sidebar-summary" aria-label="归档统计">
        <div className="newapi-sidebar-summary-title">
          <Database size={14} />
          <span>服务器存储 · 全部赛事</span>
        </div>
        <div className="newapi-sidebar-summary-row">
          <span>归档版本</span>
          <strong>{archiveStats.total_archives}</strong>
        </div>
        <div className="newapi-sidebar-summary-row">
          <span>唯一 Kernel</span>
          <strong>{archiveStats.unique_kernels}</strong>
        </div>
        <div className="newapi-sidebar-summary-row">
          <span>磁盘剩余</span>
          <strong className={archiveStats.low_disk_space ? 'is-danger' : ''}>
            {archiveStats.disk_free_bytes == null ? '未知' : formatBytes(archiveStats.disk_free_bytes)}
          </strong>
        </div>
      </div>
    );

  return (
    <div className={`newapi-app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <header className="newapi-header">
        <div className="newapi-header-brand-group">
          {!isMobile ? (
            <Tooltip title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}>
              <Button
                type="text"
                className="newapi-sidebar-trigger desktop-only"
                icon={sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
                aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
                onClick={toggleSidebar}
              />
            </Tooltip>
          ) : (
            <Button
              type="text"
              className="newapi-sidebar-trigger mobile-only"
              icon={<Menu size={18} />}
              aria-label="打开功能导航"
              onClick={() => setMobileNavOpen(true)}
            />
          )}

          <button
            type="button"
            className="newapi-brand"
            aria-label="Kaggle Harvester"
            onClick={() => navigate('/dashboard')}
          >
            <span className="newapi-brand-mark">
              <img src={kaggleLogo} alt="Kaggle" />
            </span>
            <span>Harvester</span>
          </button>
        </div>

        <div className="newapi-header-center">
          {competitionInfo && (
            <Tooltip
              title={
                health?.active_competition?.competition === competitionInfo.id &&
                health?.active_competition?.is_pinned
                  ? `全站主攻赛事：${competitionInfo.title}`
                  : `当前竞赛：${competitionInfo.title}`
              }
            >
              <button
                type="button"
                className="newapi-competition-pill"
                aria-label={`切换竞赛，快捷键 ${shortcutLabel}`}
                onClick={openCompetitionSwitcher}
              >
                <span className="dot" />
                <span className="name" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {health?.active_competition?.competition === competitionInfo.id &&
                  health?.active_competition?.is_pinned ? (
                    <>
                      <Star size={12} fill="#f59e0b" color="#f59e0b" style={{ flexShrink: 0 }} />
                      <span>{competitionInfo.title} · 全站主攻</span>
                    </>
                  ) : (
                    competitionInfo.title
                  )}
                </span>
                <kbd className="kbd">{shortcutLabel}</kbd>
              </button>
            </Tooltip>
          )}
        </div>

        <div className="newapi-header-actions">
          <Tooltip title="运行概况与诊断">
            <Badge count={runtimeIssueCount} size="small" offset={[-2, 2]}>
              <Button
                type="text"
                className="newapi-icon-button"
                icon={<Activity size={16} />}
                aria-label={`运行概况${runtimeIssueCount ? `，${runtimeIssueCount} 项异常` : ''}`}
                onClick={() => setRuntimeOpen(true)}
              />
            </Badge>
          </Tooltip>
          <Tooltip
            title={
              !backendOnline
                ? connectionError || '正在连接后端服务...'
                : isReconnecting
                ? connectionError
                : health?.ready
                ? '后端、Kaggle CLI 与 UTF-8 门禁均正常'
                : '后端已连接，但运行配置不完整'
            }
          >
            <div className="newapi-api-status">
              <span
                className={`status-dot ${
                  !backendOnline ? 'error' : isReconnecting ? 'warning' : health?.ready ? 'success' : 'warning'
                }`}
              />
              <span>
                {!backendOnline ? (loading ? '连接中' : authRequired ? '需要登录' : '连接中断') : isReconnecting ? '同步重试中' : health?.ready ? '服务正常' : '部分降级'}
              </span>
            </div>
          </Tooltip>
          <Tooltip title="刷新服务状态">
            <Button
              type="text"
              className="newapi-icon-button"
              icon={<RefreshCw size={16} />}
              aria-label="刷新服务状态"
              onClick={() => void loadData(true)}
              loading={loading}
            />
          </Tooltip>
        </div>
      </header>

      <div className="newapi-body">
        <aside className="newapi-sidebar desktop-only">
          <div className="newapi-sidebar-inner">
            {renderNavigation()}
            {renderArchiveSummary()}
          </div>
          <button
            type="button"
            className="newapi-sidebar-rail"
            aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            onClick={toggleSidebar}
          />
        </aside>

        <main className="newapi-content" id="main-content">
          {!hasLoadedOnce && loading ? (
            <div className="newapi-center-state"><Spin /><Typography.Paragraph>正在读取工作区...</Typography.Paragraph></div>
          ) : !backendOnline && !hasLoadedOnce ? (
            <div className="newapi-center-state">
              <Typography.Title level={4}>{authRequired ? '需要访问验证' : '暂时无法连接服务'}</Typography.Title>
              <Typography.Paragraph type="secondary">
                {connectionError}
              </Typography.Paragraph>
              <Button type="primary" icon={<RefreshCw size={16} />} onClick={() => authRequired ? setAuthOpen(true) : void loadData(true)}>
                {authRequired ? '输入访问码' : '重试连接'}
              </Button>
            </div>
          ) : (
            <>
              {(!backendOnline || isReconnecting) && hasLoadedOnce && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: '10px 16px',
                    borderRadius: 12,
                    background: !backendOnline ? 'rgba(255, 59, 48, 0.08)' : 'rgba(255, 149, 0, 0.09)',
                    border: !backendOnline ? '1px solid rgba(255, 59, 48, 0.22)' : '1px solid rgba(255, 149, 0, 0.22)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    animation: 'fadeIn 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: !backendOnline ? '#c0392b' : '#b45309' }}>
                    <WifiOff size={16} />
                    <span>
                      {connectionError} 当前界面保留最近一次成功获取的数据。
                    </span>
                  </div>
                  <Button
                    size="small"
                    icon={<RefreshCw size={12} className={loading ? 'spin' : ''} />}
                    loading={loading}
                    onClick={() => void loadData(true)}
                    style={{ height: 28, borderRadius: 8, fontSize: 12 }}
                  >
                    立即重试
                  </Button>
                </div>
              )}
              <Suspense
                fallback={
                  <div className="newapi-content-loading">
                    <Spin size="large" />
                    <Typography.Text type="secondary" style={{ fontSize: 13, marginTop: 8 }}>
                      正在载入页面...
                    </Typography.Text>
                  </div>
                }
              >
                <Outlet />
              </Suspense>
            </>
          )}
        </main>
      </div>

      {isMobile && (
        <MobileNavDrawer
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          renderNavigation={() => renderNavigation(true)}
          renderArchiveSummary={renderArchiveSummary}
        />
      )}

      <RuntimeDiagnosticsDrawer
        open={runtimeOpen}
        health={health}
        onClose={() => setRuntimeOpen(false)}
        onForgetApiKey={forgetApiKey}
      />

      <GlobalCompetitionSwitcherModal
        open={switcherOpen}
        competitionInfo={competitionInfo}
        enteredCompetitions={enteredCompetitions}
        health={health}
        onClose={() => setSwitcherOpen(false)}
        onSelectCompetition={handleSelectGlobalCompetition}
      />

      <ApiKeyAuthModal
        open={authOpen}
        apiKey={apiKey}
        rememberApiKey={rememberApiKey}
        authChecking={authChecking}
        onApiKeyChange={setApiKey}
        onRememberApiKeyChange={setRememberApiKey}
        onSubmit={submitApiKey}
        onCancel={() => setAuthOpen(false)}
      />
    </div>
  );
};

export default AppLayout;
