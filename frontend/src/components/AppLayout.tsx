import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Drawer, Spin, Tooltip } from 'antd';
import {
  Archive,
  ChevronLeft,
  Database,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
} from 'lucide-react';
import { api, type ArchiveStats, type CompetitionInfo, type HealthStatus } from '../api';
import { HARVESTER_EVENTS } from '../events';
import kaggleLogo from '../assets/kaggle-logo.svg';

interface NavItem {
  key: 'kernels' | 'archives';
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [archiveStats, setArchiveStats] = useState<ArchiveStats | null>(null);
  const [competitionInfo, setCompetitionInfo] = useState<CompetitionInfo | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendOnline, setBackendOnline] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('harvester.sidebarCollapsed') === 'true',
  );
  const shortcutLabel = /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api.health();
      setHealth(status);
      setBackendOnline(true);
      setArchiveStats(status.archive);
      const activeCompetition = localStorage.getItem('harvester.competition') || status.default_competition;
      const comp = await api.getCompetition(activeCompetition).catch(() => null);
      if (comp) setCompetitionInfo(comp);
    } catch {
      setBackendOnline(false);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void api.health()
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
      const competition = (event as CustomEvent<string>).detail;
      if (!competition) return;
      void api.getCompetition(competition)
        .then(setCompetitionInfo)
        .catch(() => setCompetitionInfo(null));
    };
    window.addEventListener(HARVESTER_EVENTS.competitionChanged, handleCompetitionChanged);
    return () => window.removeEventListener(HARVESTER_EVENTS.competitionChanged, handleCompetitionChanged);
  }, []);

  useEffect(() => {
    const refreshArchiveStats = () => {
      void api.getArchiveStats().then(setArchiveStats).catch(() => undefined);
    };
    window.addEventListener(HARVESTER_EVENTS.archivesChanged, refreshArchiveStats);
    return () => window.removeEventListener(HARVESTER_EVENTS.archivesChanged, refreshArchiveStats);
  }, []);

  const focusCompetitionSearch = useCallback(() => {
    if (!location.pathname.startsWith('/kernels')) navigate('/kernels');
    window.setTimeout(() => {
      window.dispatchEvent(new Event(HARVESTER_EVENTS.focusCompetition));
    }, 0);
  }, [location.pathname, navigate]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusCompetitionSearch();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [focusCompetitionSearch]);

  const currentKey: NavItem['key'] = location.pathname.startsWith('/archives') ? 'archives' : 'kernels';
  const navItems: NavItem[] = [
    { key: 'kernels', label: 'Kernel 广场', icon: <LayoutDashboard size={17} /> },
    {
      key: 'archives',
      label: '本地归档',
      icon: <Archive size={17} />,
      badge: archiveStats?.total_archives,
    },
  ];

  const handleNavigation = (key: NavItem['key']) => {
    navigate(key === 'kernels' ? '/kernels' : '/archives');
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

  const renderArchiveSummary = () => archiveStats && (
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
          onClick={() => navigate('/kernels')}
        >
          <span className="newapi-brand-mark"><img src={kaggleLogo} alt="Kaggle" /></span>
          <span>Harvester</span>
        </button>

        <nav className="newapi-top-nav" aria-label="顶部导航">
          {navItems.map((item) => (
            <button
              type="button"
              key={`top-${item.key}`}
              className={currentKey === item.key ? 'is-active' : ''}
              onClick={() => handleNavigation(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {competitionInfo && (
          <Tooltip title={`当前竞赛：${competitionInfo.title}`}>
            <button
              type="button"
              className="newapi-competition-pill"
              aria-label={`切换竞赛，快捷键 ${shortcutLabel}`}
              onClick={focusCompetitionSearch}
            >
              <Search size={16} />
              <span>{competitionInfo.title}</span>
              <kbd>{shortcutLabel}</kbd>
            </button>
          </Tooltip>
        )}

        <div className="newapi-header-actions">
          <Tooltip
            title={!backendOnline
              ? '后端服务未连接'
              : health?.ready
                ? '后端、Kaggle CLI 与 UTF-8 门禁均正常'
                : '后端已连接，但运行配置不完整'}
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
            <div className="page-loading"><Spin size="large" /></div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      <Drawer
        className="newapi-mobile-drawer"
        title={(
          <div className="newapi-drawer-title">
            <span className="newapi-brand-mark"><img src={kaggleLogo} alt="Kaggle" /></span>
            <span>Harvester</span>
          </div>
        )}
        placement="left"
        width={272}
        open={mobileNavOpen}
        closeIcon={<ChevronLeft size={18} />}
        onClose={() => setMobileNavOpen(false)}
        styles={{ body: { display: 'flex', flexDirection: 'column', padding: 8 } }}
      >
        {renderNavigation(true)}
        {renderArchiveSummary()}
      </Drawer>
    </div>
  );
};

export default AppLayout;
