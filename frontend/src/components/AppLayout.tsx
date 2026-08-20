import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Progress,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
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

const { Text, Paragraph } = Typography;

interface NavItem {
  key: 'dashboard' | 'kernels' | 'archives';
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

const redactDiagnostic = (value: string) =>
  value
    .replace(/https?:\/\/\S+/gi, '[URL 已隐藏]')
    .replace(/(token|password|secret|key)\s*[=:]\s*\S+/gi, '$1=[已隐藏]');

const copyDiagnostics = async (health: HealthStatus | null) => {
  const report = health
    ? {
        service: health.service,
        version: health.version,
        ready: health.ready,
        kaggle_cli: health.kaggle_cli,
        utf8_wrapper_exists: health.utf8_wrapper_exists,
        token_configured: health.token_configured,
        auto_archive: {
          running: health.auto_archive.running,
          scheduler_alive: health.auto_archive.scheduler_alive,
          last_error: health.auto_archive.last_error
            ? redactDiagnostic(health.auto_archive.last_error)
            : null,
        },
        submission_monitor: health.submission_monitor
          ? {
              running: health.submission_monitor.running,
              scheduler_alive: health.submission_monitor.scheduler_alive,
              last_error: health.submission_monitor.last_error
                ? redactDiagnostic(health.submission_monitor.last_error)
                : null,
            }
          : null,
        notifications: health.notifications
          ? {
              worker_alive: health.notifications.worker_alive,
              pending_count: health.notifications.pending_count,
              last_error: health.notifications.last_error
                ? redactDiagnostic(health.notifications.last_error)
                : null,
            }
          : null,
        archive: health.archive,
      }
    : { service: 'unavailable' };
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
      const activeCompetition =
        localStorage.getItem('harvester.competition') || status.default_competition;
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
      const competition = (event as CustomEvent<string>).detail;
      if (!competition) return;
      void api
        .getCompetition(competition)
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

  const currentKey: NavItem['key'] = location.pathname.startsWith('/archives')
    ? 'archives'
    : location.pathname.startsWith('/kernels')
    ? 'kernels'
    : 'dashboard';

  const runtimeErrors = [
    health?.auto_archive.last_error,
    health?.submission_monitor?.last_error,
    health?.notifications?.last_error,
  ].filter(Boolean) as string[];
  const runtimeIssueCount = runtimeErrors.length + (health?.archive.low_disk_space ? 1 : 0);

  const navItems: NavItem[] = [
    { key: 'dashboard', label: '竞赛工作台', icon: <Activity size={17} /> },
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
            </div>
          ) : !backendOnline ? (
            <div className="newapi-center-state">
              <Typography.Title level={4}>无法连接到后端服务</Typography.Title>
              <Typography.Paragraph type="secondary">
                请确认本地 Python 后端服务已启动并正在监听接口。
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

      <Drawer
        title="功能导航"
        placement="left"
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        width={280}
      >
        {renderNavigation(true)}
        <div style={{ marginTop: 24 }}>{renderArchiveSummary()}</div>
      </Drawer>

      <Drawer
        title="运行概况与系统诊断"
        placement="right"
        open={runtimeOpen}
        onClose={() => setRuntimeOpen(false)}
        width={480}
        extra={
          <Button
            type="text"
            icon={<Clipboard size={16} />}
            onClick={() => {
              void copyDiagnostics(health);
              message.success('已复制诊断报告到剪贴板');
            }}
          >
            复制报告
          </Button>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions title="服务健康度" bordered size="small" column={1}>
            <Descriptions.Item label="服务名称">{health?.service || '—'}</Descriptions.Item>
            <Descriptions.Item label="系统版本">{health?.version || '—'}</Descriptions.Item>
            <Descriptions.Item label="Kaggle CLI">
              <Tag color={health?.kaggle_cli ? 'success' : 'error'}>
                {health?.kaggle_cli ? '正常' : '未安装或异常'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Kaggle 凭据">
              <Tag color={health?.token_configured ? 'success' : 'error'}>
                {health?.token_configured ? '已配置' : '未配置'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="UTF-8 门禁">
              <Tag color={health?.utf8_wrapper_exists ? 'success' : 'warning'}>
                {health?.utf8_wrapper_exists ? '已就绪' : '缺失'}
              </Tag>
            </Descriptions.Item>
          </Descriptions>

          {health?.archive && (
            <Descriptions title="本地存储概况" bordered size="small" column={1}>
              <Descriptions.Item label="归档总版本数">
                {health.archive.total_archives}
              </Descriptions.Item>
              <Descriptions.Item label="唯一 Kernel 数">
                {health.archive.unique_kernels}
              </Descriptions.Item>
              <Descriptions.Item label="磁盘剩余可用">
                <span style={{ color: health.archive.low_disk_space ? '#ef4444' : 'inherit', fontWeight: 600 }}>
                  {formatBytes(health.archive.disk_free_bytes)}
                </span>
              </Descriptions.Item>
            </Descriptions>
          )}

          {Boolean(apiAuth.getKey()) && (
            <div style={{ paddingTop: 8 }}>
              <Button danger icon={<LogOut size={16} />} onClick={forgetApiKey} block>
                清除当前浏览器保存的 API 访问密钥
              </Button>
            </div>
          )}
        </Space>
      </Drawer>

      <Modal
        title="请输入 API 访问密钥"
        open={authOpen}
        onOk={submitApiKey}
        onCancel={() => setAuthOpen(false)}
        confirmLoading={authChecking}
        okText="验证并保存"
        cancelText="稍后"
      >
        <Paragraph type="secondary">
          当前后端服务开启了安全访问鉴权，请输入您在环境配置中设置的 `HARVESTER_API_KEY`。
        </Paragraph>
        <Input.Password
          placeholder="请输入 X-Harvester-Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onPressEnter={submitApiKey}
          style={{ marginBottom: 12 }}
        />
        <Checkbox checked={rememberApiKey} onChange={(e) => setRememberApiKey(e.target.checked)}>
          在当前浏览器长期记住该访问密钥
        </Checkbox>
      </Modal>
    </div>
  );
};

export default AppLayout;
