import React, { useCallback, useEffect, useState } from 'react';
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
  Swords,
  Trophy,
} from 'lucide-react';
import { api, apiAuth, type ArchiveStats, type CompetitionInfo, type EnteredCompetition, type HealthStatus } from '../api';
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [rememberApiKey, setRememberApiKey] = useState(true);
  const [authChecking, setAuthChecking] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('harvester.sidebarCollapsed') === 'true',
  );
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [enteredCompetitions, setEnteredCompetitions] = useState<EnteredCompetition[]>([]);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const shortcutLabel = /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K';

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadingSlow(false);
    const slowTimer = window.setTimeout(() => setLoadingSlow(true), 4000);
    try {
      const status = await api.health();
      setHealth(status);
      setBackendOnline(true);
      setArchiveStats(status.archive);
      const activeCompetition =
        localStorage.getItem('harvester.competition') ||
        status.active_competition?.competition ||
        status.default_competition;
      void api
        .getCompetition(activeCompetition)
        .then((comp) => {
          if (comp) setCompetitionInfo(comp);
        })
        .catch(() => null);
    } catch {
      setBackendOnline(false);
      setHealth(null);
    } finally {
      window.clearTimeout(slowTimer);
      setLoading(false);
      setLoadingSlow(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handleDefaultChanged = () => {
      void loadData();
    };
    window.addEventListener(HARVESTER_EVENTS.defaultCompetitionChanged, handleDefaultChanged);
    return () =>
      window.removeEventListener(HARVESTER_EVENTS.defaultCompetitionChanged, handleDefaultChanged);
  }, [loadData]);

  useEffect(() => {
    const requireAuth = () => setAuthOpen(true);
    window.addEventListener('harvester:auth-required', requireAuth);
    return () => window.removeEventListener('harvester:auth-required', requireAuth);
  }, []);

  const submitApiKey = async () => {
    if (!apiKey.trim()) return;
    setAuthChecking(true);
    apiAuth.setKey(apiKey, rememberApiKey);
    try {
      await api.health();
      setAuthOpen(false);
      setApiKey('');
      message.success(rememberApiKey ? '访问密钥已记住' : '访问密钥验证成功');
      await loadData();
    } catch {
      apiAuth.clearKey();
      message.error('访问密钥无效');
    } finally {
      setAuthChecking(false);
    }
  };

  const forgetApiKey = () => {
    apiAuth.clearKey();
    setRuntimeOpen(false);
    setApiKey('');
    setAuthOpen(true);
    message.success('已清除当前浏览器保存的访问密钥');
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      void api
        .health()
        .then((status) => {
          setHealth(status);
          setBackendOnline(true);
          setArchiveStats(status.archive);
        })
        .catch(() => setBackendOnline(false));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
    { key: 'kernels', label: 'Kernel 广场', icon: <LayoutDashboard size={17} /> },
    {
      key: 'archives',
      label: '本地归档',
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
          <span>本地存储</span>
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
            {formatBytes(archiveStats.disk_free_bytes)}
          </strong>
        </div>
      </div>
    );

  return (
    <div className={`newapi-app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <header className="newapi-header">
        <Tooltip title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}>
          <Button
            type="text"
            className="newapi-sidebar-trigger desktop-only"
            icon={sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            onClick={toggleSidebar}
          />
        </Tooltip>
        <Button
          type="text"
          className="newapi-sidebar-trigger mobile-only"
          icon={<Menu size={18} />}
          aria-label="打开功能导航"
          onClick={() => setMobileNavOpen(true)}
        />

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
              <Trophy size={15} color="#1677ff" />
              <span>
                {health?.active_competition?.competition === competitionInfo.id &&
                health?.active_competition?.is_pinned
                  ? `⭐ ${competitionInfo.title}`
                  : competitionInfo.title}
              </span>
              <kbd>{shortcutLabel}</kbd>
            </button>
          </Tooltip>
        )}

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
                ? '后端服务未连接'
                : health?.ready
                ? '后端、Kaggle CLI 与 UTF-8 门禁均正常'
                : '后端已连接，但运行配置不完整'
            }
          >
            <div className="newapi-api-status">
              <Badge status={!backendOnline ? 'error' : health?.ready ? 'success' : 'warning'} />
              <span>{backendOnline ? '服务正常' : '连接失败'}</span>
            </div>
          </Tooltip>
          <Tooltip title="刷新服务状态">
            <Button
              type="text"
              className="newapi-icon-button"
              icon={<RefreshCw size={16} />}
              aria-label="刷新服务状态"
              onClick={loadData}
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
          {loading && !backendOnline ? (
            <div className="newapi-center-state">
              <Spin size="large" />
              <Typography.Text type="secondary">正在连接 Kaggle Harvester 后端服务...</Typography.Text>
              {loadingSlow && (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    移动端连接较慢，若长时间无响应可点击下方重试
                  </Typography.Text>
                  <Button size="small" onClick={loadData}>
                    重试连接
                  </Button>
                </div>
              )}
            </div>
          ) : !backendOnline ? (
            <div className="newapi-center-state">
              <Typography.Title level={4}>无法连接到后端服务</Typography.Title>
              <Typography.Paragraph type="secondary">
                请确认本地 Python 后端服务已启动并正在监听接口。移动端访问请确保处于同一 Wi-Fi 局域网。
              </Typography.Paragraph>
              <Button type="primary" icon={<RefreshCw size={16} />} onClick={loadData}>
                重试连接
              </Button>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        renderNavigation={() => renderNavigation(true)}
        renderArchiveSummary={renderArchiveSummary}
      />

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
