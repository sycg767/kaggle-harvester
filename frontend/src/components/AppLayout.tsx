import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Alert, App as AntApp, Badge, Button, Checkbox, Descriptions, Drawer, Input, Modal, Progress, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import {
  Archive,
  Activity,
  ChevronLeft,
  Clipboard,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
} from 'lucide-react';
import { api, apiAuth, type ArchiveStats, type CompetitionInfo, type HealthStatus } from '../api';
import { HARVESTER_EVENTS } from '../events';
import kaggleLogo from '../assets/kaggle-logo.svg';

interface NavItem {
  key: 'kernels' | 'archives';
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

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

const redactDiagnostic = (value: string) => value
  .replace(/https?:\/\/\S+/gi, '[URL 已隐藏]')
  .replace(/(token|password|secret|key)\s*[=:]\s*\S+/gi, '$1=[已隐藏]');

const copyDiagnostics = async (health: HealthStatus | null) => {
  const report = health ? {
    service: health.service,
    version: health.version,
    ready: health.ready,
    kaggle_cli: health.kaggle_cli,
    utf8_wrapper_exists: health.utf8_wrapper_exists,
    token_configured: health.token_configured,
    auto_archive: {
      running: health.auto_archive.running,
      scheduler_alive: health.auto_archive.scheduler_alive,
      last_error: health.auto_archive.last_error ? redactDiagnostic(health.auto_archive.last_error) : null,
    },
    submission_monitor: health.submission_monitor ? {
      running: health.submission_monitor.running,
      scheduler_alive: health.submission_monitor.scheduler_alive,
      last_error: health.submission_monitor.last_error ? redactDiagnostic(health.submission_monitor.last_error) : null,
    } : null,
    notifications: health.notifications ? {
      worker_alive: health.notifications.worker_alive,
      pending_count: health.notifications.pending_count,
      last_error: health.notifications.last_error ? redactDiagnostic(health.notifications.last_error) : null,
    } : null,
    archive: health.archive,
  } : { service: 'unavailable' };
  await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
};

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
  const runtimeErrors = [
    health?.auto_archive.last_error,
    health?.submission_monitor?.last_error,
    health?.notifications?.last_error,
  ].filter(Boolean) as string[];
  const runtimeIssueCount = runtimeErrors.length + (health?.archive.low_disk_space ? 1 : 0);
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
      <Drawer
        title="运行概况"
        placement="right"
        width={420}
        open={runtimeOpen}
        onClose={() => setRuntimeOpen(false)}
        extra={(
          <Space>
            <Tooltip title="复制脱敏诊断信息">
              <Button
                type="text"
                icon={<Clipboard size={16} />}
                aria-label="复制诊断信息"
                onClick={() => void copyDiagnostics(health).then(() => message.success('诊断信息已复制'))}
              />
            </Tooltip>
            <Tooltip title="刷新运行状态">
              <Button type="text" icon={<RefreshCw size={16} />} loading={loading} onClick={loadData} />
            </Tooltip>
          </Space>
        )}
      >
        {!health ? (
          <Alert type="error" showIcon message="后端服务未连接" description="请确认后端已经启动并可访问。" />
        ) : (
          <div className="runtime-overview">
            {runtimeErrors.map((error, index) => (
              <Alert key={`${error}-${index}`} type="error" showIcon message={redactDiagnostic(error)} />
            ))}
            {health.archive.low_disk_space && (
              <Alert type="error" showIcon message="磁盘剩余空间低于归档保护阈值" />
            )}
            <section>
              <Typography.Title level={5}>服务</Typography.Title>
              <Descriptions size="small" column={1} colon={false}>
                <Descriptions.Item label="状态"><Tag color={health.ready ? 'success' : 'warning'}>{health.ready ? '就绪' : '配置不完整'}</Tag></Descriptions.Item>
                <Descriptions.Item label="版本">{health.version}</Descriptions.Item>
                <Descriptions.Item label="Kaggle CLI">{health.kaggle_cli ? '可用' : '不可用'}</Descriptions.Item>
                <Descriptions.Item label="访问凭据">{health.token_configured ? '已配置' : '未配置'}</Descriptions.Item>
              </Descriptions>
              {!!apiAuth.getKey() && (
                <Button
                  type="text"
                  danger
                  icon={<LogOut size={15} />}
                  onClick={forgetApiKey}
                >
                  清除访问密钥
                </Button>
              )}
            </section>
            <section>
              <Typography.Title level={5}>自动归档</Typography.Title>
              <Descriptions size="small" column={1} colon={false}>
                <Descriptions.Item label="任务">{health.auto_archive.running ? '正在检查' : health.auto_archive.scheduler_alive ? '调度器在线' : '调度器离线'}</Descriptions.Item>
                <Descriptions.Item label="下次检查">{formatDate(health.auto_archive.next_run_at)}</Descriptions.Item>
                <Descriptions.Item label="最近结果">{health.auto_archive.archived_count} 新增 / {health.auto_archive.failed_count} 失败</Descriptions.Item>
              </Descriptions>
            </section>
            <section>
              <Typography.Title level={5}>出分监控</Typography.Title>
              <Descriptions size="small" column={1} colon={false}>
                <Descriptions.Item label="任务">{health.submission_monitor?.running ? '正在检查' : health.submission_monitor?.scheduler_alive ? '调度器在线' : '调度器离线'}</Descriptions.Item>
                <Descriptions.Item label="下次检查">{formatDate(health.submission_monitor?.next_run_at)}</Descriptions.Item>
                <Descriptions.Item label="最近结果">{health.submission_monitor?.pending_count ?? 0} 待出分 / {health.submission_monitor?.failed_count ?? 0} 失败</Descriptions.Item>
              </Descriptions>
            </section>
            <section>
              <Typography.Title level={5}>通知</Typography.Title>
              <Descriptions size="small" column={1} colon={false}>
                <Descriptions.Item label="发送队列">{health.notifications?.pending_count ?? 0}</Descriptions.Item>
                <Descriptions.Item label="最近发送">{formatDate(health.notifications?.last_sent_at)}</Descriptions.Item>
              </Descriptions>
            </section>
            <section>
              <Typography.Title level={5}>本地存储</Typography.Title>
              <Progress percent={health.archive.disk_used_percent} status={health.archive.low_disk_space ? 'exception' : 'normal'} size="small" />
              <Descriptions size="small" column={1} colon={false}>
                <Descriptions.Item label="磁盘剩余">{formatBytes(health.archive.disk_free_bytes)} / {formatBytes(health.archive.disk_total_bytes)}</Descriptions.Item>
                <Descriptions.Item label="归档占用">{formatBytes(health.archive.total_size_bytes)}</Descriptions.Item>
                <Descriptions.Item label="保护阈值">{formatBytes(health.archive.min_free_bytes)}</Descriptions.Item>
              </Descriptions>
            </section>
          </div>
        )}
      </Drawer>
      <Modal
        title="需要访问密钥"
        open={authOpen}
        closable={false}
        maskClosable={false}
        okText="验证"
        cancelButtonProps={{ style: { display: 'none' } }}
        confirmLoading={authChecking}
        onOk={() => void submitApiKey()}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Input.Password
            value={apiKey}
            autoFocus
            aria-label="访问密钥"
            placeholder="输入 HARVESTER_API_KEY"
            onChange={(event) => setApiKey(event.target.value)}
            onPressEnter={() => void submitApiKey()}
          />
          <Checkbox
            checked={rememberApiKey}
            onChange={(event) => setRememberApiKey(event.target.checked)}
          >
            记住此浏览器
          </Checkbox>
          {rememberApiKey && (
            <Typography.Text type="secondary">
              密钥会保存在当前浏览器中，请勿在公共或共享设备上使用。
            </Typography.Text>
          )}
        </Space>
      </Modal>
    </div>
  );
};

export default AppLayout;
