import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
  theme,
  type TableColumnsType,
  type InputRef,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CloudDownloadOutlined,
  CodeOutlined,
  EyeOutlined,
  ExportOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  StarOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Filter } from 'lucide-react';
import {
  api,
  type ArchiveEntry,
  type CompetitionInfo,
  type KernelCacheInfo,
  type ScoredKernel,
  type VersionInfo,
} from '../api';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleKernelVersionUrl,
  kaggleOwnerFromRef,
} from '../kaggleUrls';
import AutoArchiveControl from './AutoArchiveControl';
import DialogTitle from './DialogTitle';
import {
  dispatchArchivesChanged,
  dispatchCompetitionChanged,
  HARVESTER_EVENTS,
} from '../events';

const { Text } = Typography;
const DEFAULT_COMPETITION = 'rogii-wellbore-geology-prediction';
const RECENT_COMPETITIONS_KEY = 'harvester.recentCompetitions';
const MOBILE_PAGE_SIZE = 10;
const SORT_OPTIONS = [
  { value: 'scoreAscending', label: '公开分数 · 最佳优先' },
  { value: 'scoreDescending', label: '公开分数 · 倒序' },
  { value: 'hotness', label: '热度' },
  { value: 'dateRun', label: '运行时间' },
  { value: 'dateCreated', label: '创建时间' },
  { value: 'voteCount', label: '投票数（非分数榜）' },
];
type ArchiveVersionChoice = 'best' | 'latest' | `version:${number}`;

const readRecentCompetitions = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_COMPETITIONS_KEY) || '[]');
    if (Array.isArray(stored)) {
      return stored.filter((value): value is string => typeof value === 'string');
    }
  } catch {
    // 缓存格式异常时回退到默认竞赛，不影响页面使用。
  }
  return [];
};

const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

const formatCacheAge = (seconds: number) => {
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
};

const waitForRefreshPoll = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    window.clearTimeout(timer);
    reject(new DOMException('请求已取消', 'AbortError'));
  }, { once: true });
});

const renderVersionStatus = (value?: string) => {
  const normalized = (value || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  if (['complete', 'completed', 'success', 'succeeded'].includes(normalized)) {
    return <Tag color="success" icon={<CheckCircleOutlined />}>已完成</Tag>;
  }
  if (['running', 'active'].includes(normalized)) {
    return <Tag color="processing" icon={<LoadingOutlined />}>运行中</Tag>;
  }
  if (['queued', 'pending', 'submitted'].includes(normalized)) {
    return <Tag color="gold" icon={<ClockCircleOutlined />}>排队中</Tag>;
  }
  if (['failed', 'error'].includes(normalized)) {
    return <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>;
  }
  if (normalized.includes('cancel')) {
    const label = normalized.includes('request') ? '取消中' : '已取消';
    return <Tag color="warning" icon={<MinusCircleOutlined />}>{label}</Tag>;
  }
  if (normalized === 'draft') {
    return <Tag>草稿</Tag>;
  }
  return <Tag>{value || '未知'}</Tag>;
};

const KernelList: React.FC = () => {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const competitionInputRef = useRef<InputRef>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);

  const [competitionInput, setCompetitionInput] = useState(
    () => localStorage.getItem('harvester.competition') || DEFAULT_COMPETITION,
  );
  const [competition, setCompetition] = useState(
    () => localStorage.getItem('harvester.competition') || DEFAULT_COMPETITION,
  );
  const [recentCompetitions, setRecentCompetitions] = useState(() => {
    const current = localStorage.getItem('harvester.competition') || DEFAULT_COMPETITION;
    return [...new Set([current, DEFAULT_COMPETITION, ...readRecentCompetitions()])].slice(0, 8);
  });
  const [sortBy, setSortBy] = useState('scoreAscending');
  const [pageSize, setPageSize] = useState(50);
  const [maxPages, setMaxPages] = useState(1);
  const [scoreLimit, setScoreLimit] = useState(50);
  const [kernels, setKernels] = useState<ScoredKernel[]>([]);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [competitionInfo, setCompetitionInfo] = useState<CompetitionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<KernelCacheInfo | null>(null);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobilePage, setMobilePage] = useState(1);

  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionKernel, setVersionKernel] = useState<ScoredKernel | null>(null);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveTargets, setArchiveTargets] = useState<ScoredKernel[]>([]);
  const [archiveVersionChoice, setArchiveVersionChoice] = useState<ArchiveVersionChoice>('best');
  const [archiveVersions, setArchiveVersions] = useState<VersionInfo[]>([]);
  const [archiveVersionsLoading, setArchiveVersionsLoading] = useState(false);
  const [archiveVersionsError, setArchiveVersionsError] = useState<string | null>(null);
  const [includeOutputs, setIncludeOutputs] = useState(true);
  const [archiveRunning, setArchiveRunning] = useState(false);
  const [archiveCompleted, setArchiveCompleted] = useState(false);
  const [archiveProgress, setArchiveProgress] = useState(0);
  const [archiveSuccesses, setArchiveSuccesses] = useState(0);
  const [archiveFailures, setArchiveFailures] = useState<string[]>([]);

  const loadKernels = async (refresh = false, requestedCompetition?: string) => {
    const nextCompetition = (requestedCompetition ?? competitionInput).trim();
    if (!/^[a-z0-9][a-z0-9-]{2,119}$/i.test(nextCompetition)) {
      setError('竞赛标识格式无效，请使用 Kaggle URL 中的英文 slug。');
      return;
    }

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    setLoading(true);
    setBackgroundRefreshing(false);
    setError(null);
    setElapsedSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );

    try {
      const scoreSorted = sortBy === 'scoreAscending' || sortBy === 'scoreDescending';
      const queryParams = {
        competition: nextCompetition,
        sort_by: sortBy,
        page_size: scoreSorted ? 50 : pageSize,
        max_pages: scoreSorted ? 1 : maxPages,
        include_scores: true,
        score_limit: scoreSorted ? 50 : scoreLimit,
      };
      const result = await api.listKernels({
        ...queryParams,
        refresh,
        signal: controller.signal,
      });
      if (requestSequence !== requestSequenceRef.current) return;
      setKernels(result.items);
      setCacheInfo(result.cache);
      setBackgroundRefreshing(result.cache.refreshing);
      setCompetition(nextCompetition);
      setCompetitionInput(nextCompetition);
      setSelectedRowKeys([]);
      localStorage.setItem('harvester.competition', nextCompetition);
      setRecentCompetitions((current) => {
        const next = [nextCompetition, ...current.filter((value) => value !== nextCompetition)].slice(0, 8);
        localStorage.setItem(RECENT_COMPETITIONS_KEY, JSON.stringify(next));
        return next;
      });

      const [comp, archiveData] = await Promise.all([
        api.getCompetition(nextCompetition, { signal: controller.signal }).catch(() => null),
        api.listArchives(nextCompetition, controller.signal).catch(() => []),
      ]);
      if (controller.signal.aborted || requestSequence !== requestSequenceRef.current) return;
      setCompetitionInfo(comp);
      setArchives(archiveData);
      dispatchCompetitionChanged(nextCompetition);

      if (result.cache.refreshing) {
        void (async () => {
          try {
            for (let attempt = 0; attempt < 20; attempt += 1) {
              await waitForRefreshPoll(1_500, controller.signal);
              const refreshed = await api.listKernels({
                ...queryParams,
                signal: controller.signal,
              });
              if (requestSequence !== requestSequenceRef.current) return;
              setCacheInfo(refreshed.cache);
              setBackgroundRefreshing(refreshed.cache.refreshing);
              if (!refreshed.cache.refreshing && refreshed.cache.state !== 'STALE') {
                setKernels(refreshed.items);
                return;
              }
            }
            if (requestSequence === requestSequenceRef.current) {
              setBackgroundRefreshing(false);
            }
          } catch (pollError) {
            if (!(pollError instanceof DOMException && pollError.name === 'AbortError')) {
              setBackgroundRefreshing(false);
            }
          }
        })();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Kernel 列表加载失败。');
    } finally {
      window.clearInterval(timer);
      if (requestSequence === requestSequenceRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadKernels(false);
    // 初次进入页面只按默认配置读取一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  useEffect(() => {
    const focusCompetition = () => {
      competitionInputRef.current?.focus({ cursor: 'all' });
    };
    window.addEventListener(HARVESTER_EVENTS.focusCompetition, focusCompetition);
    return () => window.removeEventListener(HARVESTER_EVENTS.focusCompetition, focusCompetition);
  }, []);

  const archivedVersions = useMemo(() => {
    const result = new Map<string, number[]>();
    for (const archive of archives) {
      const values = result.get(archive.ref) || [];
      values.push(archive.version_number);
      result.set(archive.ref, values.sort((a, b) => b - a));
    }
    return result;
  }, [archives]);

  const competitionOptions = useMemo(
    () => recentCompetitions.map((value) => ({ value, label: value })),
    [recentCompetitions],
  );

  const displayKernels = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const filtered = kernels.filter((kernel) => {
      const hasScore = kernel.public_score !== undefined && kernel.public_score !== null;
      if (scoreFilter === 'scored' && !hasScore) return false;
      if (scoreFilter === 'unscored' && hasScore) return false;
      if (!query) return true;
      return [kernel.ref, kernel.title, kernel.author]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });

    if (sortBy !== 'scoreAscending' && sortBy !== 'scoreDescending') return filtered;

    const direction = sortBy === 'scoreAscending' ? 1 : -1;
    return [...filtered].sort((left, right) => {
      const leftScore = left.public_score;
      const rightScore = right.public_score;
      if (leftScore === undefined || leftScore === null) return 1;
      if (rightScore === undefined || rightScore === null) return -1;
      return (leftScore - rightScore) * direction;
    });
  }, [kernels, scoreFilter, searchText, sortBy]);

  useEffect(() => {
    setMobilePage(1);
  }, [kernels, scoreFilter, searchText, sortBy]);

  const mobileKernels = useMemo(
    () => displayKernels.slice((mobilePage - 1) * MOBILE_PAGE_SIZE, mobilePage * MOBILE_PAGE_SIZE),
    [displayKernels, mobilePage],
  );

  const scoredKernels = useMemo(
    () => kernels.filter((kernel) => kernel.public_score !== undefined && kernel.public_score !== null),
    [kernels],
  );

  const bestScore = useMemo(() => {
    const scores = scoredKernels.map((kernel) => kernel.public_score as number);
    if (!scores.length) return null;
    return competitionInfo?.is_lower_better === false ? Math.max(...scores) : Math.min(...scores);
  }, [competitionInfo?.is_lower_better, scoredKernels]);

  const archiveLatestVersion = useMemo(
    () => archiveVersions.reduce<VersionInfo | null>(
      (latest, version) => !latest || version.version_number > latest.version_number ? version : latest,
      null,
    ),
    [archiveVersions],
  );

  const archiveBestVersion = useMemo(() => {
    const scored = archiveVersions.filter(
      (version) => version.public_lb_numeric !== undefined && version.public_lb_numeric !== null,
    );
    if (!scored.length) return archiveLatestVersion;
    return scored.reduce((best, version) => {
      const bestScoreValue = best.public_lb_numeric as number;
      const currentScore = version.public_lb_numeric as number;
      if (competitionInfo?.is_lower_better === false) {
        return currentScore > bestScoreValue ? version : best;
      }
      return currentScore < bestScoreValue ? version : best;
    });
  }, [archiveLatestVersion, archiveVersions, competitionInfo?.is_lower_better]);

  const archiveVersionOptions = useMemo(() => {
    const versionLabel = (version: VersionInfo | null, fallback: string) => {
      if (!version) return fallback;
      const score = version.public_lb_numeric;
      return `${fallback} · v${version.version_number}${score === undefined || score === null ? ' · 暂无分数' : ` · ${score.toFixed(4)}`}`;
    };
    return [
      {
        label: '推荐',
        options: [
          { value: 'best', label: versionLabel(archiveBestVersion, '最佳分数版本') },
          ...(archiveLatestVersion
            ? [{ value: 'latest', label: versionLabel(archiveLatestVersion, '最新版本') }]
            : []),
        ],
      },
      ...(archiveVersions.length
        ? [{
          label: '所有历史版本',
          options: archiveVersions.map((version) => ({
            value: `version:${version.version_number}`,
            label: `v${version.version_number} · ${version.public_lb_numeric === undefined || version.public_lb_numeric === null ? '暂无分数' : version.public_lb_numeric.toFixed(4)} · ${formatDate(version.date_created)}`,
          })),
        }]
        : []),
    ];
  }, [archiveBestVersion, archiveLatestVersion, archiveVersions]);

  const selectedKernels = useMemo(() => {
    const selected = new Set(selectedRowKeys.map(String));
    return kernels.filter((kernel) => selected.has(kernel.ref));
  }, [kernels, selectedRowKeys]);

  const getScoreColor = (score?: number) => {
    if (score === undefined || score === null) return token.colorTextSecondary;
    if (bestScore !== null && Math.abs(score - bestScore) < 1e-9) return token.colorSuccess;
    return token.colorText;
  };

  const openArchiveDialog = (targets: ScoredKernel[], version?: number) => {
    if (!targets.length) return;
    if (version !== undefined) setVersionModalOpen(false);
    setArchiveTargets(targets);
    setArchiveVersionChoice(version === undefined ? 'best' : `version:${version}`);
    setArchiveVersions([]);
    setArchiveVersionsError(null);
    setIncludeOutputs(true);
    setArchiveRunning(false);
    setArchiveCompleted(false);
    setArchiveProgress(0);
    setArchiveSuccesses(0);
    setArchiveFailures([]);
    setArchiveModalOpen(true);

    if (targets.length === 1) {
      const [owner, slug] = targets[0].ref.split('/', 2);
      setArchiveVersionsLoading(true);
      void api.getKernelVersions(owner, slug, false)
        .then((data) => setArchiveVersions(
          [...data.versions].sort((a, b) => b.version_number - a.version_number),
        ))
        .catch((err) => setArchiveVersionsError(
          err instanceof Error ? err.message : '版本列表读取失败。',
        ))
        .finally(() => setArchiveVersionsLoading(false));
    } else {
      setArchiveVersionsLoading(false);
    }
  };

  const runArchive = async () => {
    setArchiveRunning(true);
    setArchiveCompleted(false);
    let successes = 0;
    const failures: string[] = [];

    for (let index = 0; index < archiveTargets.length; index += 1) {
      const kernel = archiveTargets[index];
      try {
        let selectedVersion: number | undefined;
        if (archiveTargets.length === 1) {
          if (archiveVersionChoice.startsWith('version:')) {
            selectedVersion = Number(archiveVersionChoice.slice('version:'.length));
          } else if (archiveVersionChoice === 'latest') {
            selectedVersion = archiveLatestVersion?.version_number;
          }
        }
        await api.archiveKernel({
          kernel_ref: kernel.ref,
          version: selectedVersion,
          score_direction: 'auto',
          include_outputs: includeOutputs,
          competition,
        });
        successes += 1;
      } catch (err) {
        failures.push(`${kernel.ref}：${err instanceof Error ? err.message : '未知错误'}`);
      }
      setArchiveSuccesses(successes);
      setArchiveFailures([...failures]);
      setArchiveProgress(Math.round(((index + 1) / archiveTargets.length) * 100));
    }

    setArchiveRunning(false);
    setArchiveCompleted(true);
    if (successes) {
      setArchives(await api.listArchives(competition).catch(() => archives));
      setSelectedRowKeys([]);
      dispatchArchivesChanged();
      message.success(`已完成 ${successes} 个归档`);
    }
  };

  const showVersions = async (kernel: ScoredKernel, refresh = false) => {
    setVersionKernel(kernel);
    setVersionModalOpen(true);
    setVersions([]);
    setVersionsError(null);
    setVersionsLoading(true);
    try {
      const [owner, slug] = kernel.ref.split('/', 2);
      const data = await api.getKernelVersions(owner, slug, refresh);
      setVersions([...data.versions].sort((a, b) => b.version_number - a.version_number));
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : '版本历史读取失败。');
    } finally {
      setVersionsLoading(false);
    }
  };

  const columns: TableColumnsType<ScoredKernel> = [
    {
      title: '分数',
      dataIndex: 'public_score',
      width: 110,
      sorter: (a, b) => (a.public_score ?? Number.POSITIVE_INFINITY) - (b.public_score ?? Number.POSITIVE_INFINITY),
      render: (score?: number) => (
        <Space>
          <TrophyOutlined style={{ color: getScoreColor(score) }} />
          <Text strong style={{ color: getScoreColor(score) }}>
            {score === undefined || score === null ? '—' : score.toFixed(4)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Kernel',
      key: 'kernel',
      width: 290,
      render: (_, record) => (
        <div style={{ minWidth: 0 }}>
          <a
            href={kaggleKernelUrl(record.ref)}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'block', overflow: 'hidden', fontWeight: 600, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {record.title || record.ref}
          </a>
          <Text type="secondary" ellipsis style={{ display: 'block', fontSize: 12 }}>
            {record.ref}
          </Text>
        </div>
      ),
    },
    {
      title: '作者',
      dataIndex: 'author',
      width: 135,
      ellipsis: true,
      render: (author: string, record: ScoredKernel) => {
        const username = kaggleOwnerFromRef(record.ref);
        return (
          <Space align="start">
            <UserOutlined style={{ marginTop: 4 }} />
            <a
              href={kaggleAuthorUrl(username)}
              target="_blank"
              rel="noreferrer"
              aria-label={`打开 @${username} 的 Kaggle 主页`}
            >
              <span style={{ display: 'block' }}>{author || username}</span>
              <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                @{username}
              </Text>
            </a>
          </Space>
        );
      },
    },
    {
      title: '投票',
      dataIndex: 'total_votes',
      width: 85,
      sorter: (a, b) => a.total_votes - b.total_votes,
      render: (votes: number) => <Space><StarOutlined style={{ color: token.colorWarning }} />{votes}</Space>,
    },
    {
      title: '最后运行',
      dataIndex: 'last_run_time',
      width: 170,
      render: (value?: string) => <Space><ClockCircleOutlined /><Text type="secondary">{formatDate(value)}</Text></Space>,
    },
    {
      title: '本地状态',
      width: 120,
      render: (_, record) => {
        const values = archivedVersions.get(record.ref);
        return values?.length ? (
          <Tooltip title={values.map((value) => `v${value}`).join('、')}>
            <Tag color="success" icon={<CheckCircleOutlined />}>{values.length} 个版本</Tag>
          </Tooltip>
        ) : <Text type="secondary">未归档</Text>;
      },
    },
    {
      title: '操作',
      fixed: 'right',
      width: 125,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="查看版本历史">
            <Button icon={<EyeOutlined />} aria-label={`查看 ${record.ref} 的版本`} onClick={() => showVersions(record)} />
          </Tooltip>
          <Tooltip title="归档最佳版本">
            <Button type="primary" icon={<CloudDownloadOutlined />} aria-label={`归档 ${record.ref}`} onClick={() => openArchiveDialog([record])} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="page-title-wrap">
          <h1 className="page-title">Kernel 广场</h1>
          <span className="page-subtitle">浏览公开分数榜并保存可复现的本地版本</span>
        </div>
        <div className="page-actions">
          <AutoArchiveControl
            currentCompetition={competition}
            onArchiveComplete={() => {
              void api.listArchives(competition).then(setArchives).catch(() => undefined);
              dispatchArchivesChanged();
            }}
          />
          <Button
            icon={<ReloadOutlined />}
            aria-label={sortBy === 'scoreAscending' || sortBy === 'scoreDescending' ? '刷新分数榜' : '强制刷新'}
            loading={loading}
            onClick={() => loadKernels(true)}
          >
            {sortBy === 'scoreAscending' || sortBy === 'scoreDescending' ? '刷新分数榜' : '强制刷新'}
          </Button>
        </div>
      </header>

      <div className="page-content">
        <div className="metric-grid">
          <Card size="small" className="metric-card">
            <Statistic title="已加载 Kernel" value={kernels.length} suffix="个" prefix={<CodeOutlined />} />
          </Card>
          <Card size="small" className="metric-card">
            <Statistic title="已有分数" value={scoredKernels.length} suffix="个" prefix={<ThunderboltOutlined />} />
          </Card>
          <Card size="small" className="metric-card">
            <Statistic title="当前最佳" value={bestScore ?? '—'} precision={bestScore === null ? undefined : 4} prefix={<TrophyOutlined />} />
          </Card>
        </div>

      <Card size="small" className="data-toolbar">
        <Row gutter={[8, 8]} align="middle" className="toolbar-primary-row">
          <Col xs={24} md={10} lg={10} className="toolbar-competition-control">
            <AutoComplete
              className="overview-competition-select"
              value={competitionInput}
              options={competitionOptions}
              onChange={setCompetitionInput}
              filterOption={(inputValue, option) =>
                String(option?.value || '').toLowerCase().includes(inputValue.toLowerCase())
              }
            >
              <Input
                ref={competitionInputRef}
                aria-label="选择或输入 Kaggle 竞赛标识"
                prefix={<TrophyOutlined />}
                placeholder="选择或输入竞赛"
                onPressEnter={() => loadKernels(false)}
              />
            </AutoComplete>
          </Col>
          <Col md={5} lg={5} className="desktop-sort-control">
            <Select
              aria-label="Kernel 排序方式"
              value={sortBy}
              onChange={setSortBy}
              style={{ width: '100%' }}
              options={SORT_OPTIONS}
            />
          </Col>
          <Col xs={12} md={4} lg={4} className="toolbar-query-control">
            <Button type="primary" icon={<SearchOutlined />} loading={loading} block onClick={() => loadKernels(false)}>
              搜索
            </Button>
          </Col>
          <Col xs={12} className="mobile-filter-control">
            <Button
              block
              icon={<Filter size={15} />}
              aria-expanded={mobileFiltersOpen}
              onClick={() => setMobileFiltersOpen((current) => !current)}
            >
              筛选
            </Button>
          </Col>
          <Col xs={24} md={5} lg={5} className="toolbar-status-control">
            <Space wrap size={6} className="kernel-filter-status">
              {cacheInfo && (
                <Tooltip
                  title={
                    cacheInfo.state === 'HIT'
                      ? '本次未访问 Kaggle，直接读取磁盘快照'
                      : cacheInfo.state === 'STALE'
                        ? backgroundRefreshing
                          ? '正在展示上次成功榜单，后台同步检查新版本'
                          : '后台检查未完成，继续展示上次成功榜单'
                        : '本次结果已写入磁盘缓存'
                  }
                >
                  <Tag color={backgroundRefreshing ? 'processing' : cacheInfo.state === 'STALE' ? 'orange' : cacheInfo.state === 'HIT' ? 'green' : undefined}>
                    {backgroundRefreshing
                      ? `后台更新中 · ${formatCacheAge(cacheInfo.age_seconds)}`
                      : cacheInfo.state === 'HIT'
                      ? `缓存 · ${formatCacheAge(cacheInfo.age_seconds)}`
                      : cacheInfo.state === 'REFRESH'
                        ? '已强制刷新'
                        : cacheInfo.state === 'UPDATE'
                          ? '榜单已更新'
                          : cacheInfo.state === 'STALE'
                            ? '使用旧榜单'
                            : '已建立缓存'}
                  </Tag>
                </Tooltip>
              )}
              {competitionInfo && (
                <Tooltip title={competitionInfo.score_direction_source === 'fallback' ? '平台未返回明确方向，当前使用兼容推断' : '已根据竞赛信息或公开榜单识别'}>
                  <Tag color={competitionInfo.score_direction_source === 'fallback' ? 'warning' : 'blue'}>
                    {competitionInfo.is_lower_better ? '越低越好' : '越高越好'}
                  </Tag>
                </Tooltip>
              )}
              <Text type="secondary" className="kernel-score-count">{scoredKernels.length}/{kernels.length} 有分数</Text>
            </Space>
          </Col>
        </Row>

        <div className={`toolbar-advanced${mobileFiltersOpen ? ' is-open' : ''}`}>
          <div className="toolbar-divider" />
          <Row gutter={[8, 8]} align="middle">
            <Col xs={24} className="mobile-sort-control">
              <Select aria-label="Kernel 排序方式" value={sortBy} onChange={setSortBy} style={{ width: '100%' }} options={SORT_OPTIONS} />
            </Col>
            <Col xs={24} md={12}>
              <Input aria-label="筛选 Kernel" allowClear value={searchText} onChange={(event) => setSearchText(event.target.value)} prefix={<SearchOutlined />} placeholder="标题、作者或 ref" />
            </Col>
            <Col xs={24} md={6}>
              <Select aria-label="分数筛选" value={scoreFilter} onChange={setScoreFilter} style={{ width: '100%' }} options={[
                { value: 'all', label: '全部分数' },
                { value: 'scored', label: '已有分数' },
                { value: 'unscored', label: '暂无分数' },
              ]} />
            </Col>
            {sortBy !== 'scoreAscending' && sortBy !== 'scoreDescending' && (
              <>
                <Col xs={12} md={4}>
                  <InputNumber aria-label="每页 Kernel 数量" min={10} max={200} step={10} value={pageSize} onChange={(value) => setPageSize(value || 50)} style={{ width: '100%' }} addonBefore="每页" />
                </Col>
                <Col xs={12} md={4}>
                  <InputNumber aria-label="读取页数" min={1} max={10} value={maxPages} onChange={(value) => setMaxPages(value || 1)} style={{ width: '100%' }} addonBefore="页数" />
                </Col>
                <Col xs={24} md={4}>
                  <Select aria-label="读取分数数量" value={scoreLimit} onChange={setScoreLimit} style={{ width: '100%' }} options={[10, 20, 30, 50].map((value) => ({ value, label: `读取前 ${value} 条分数` }))} />
                </Col>
              </>
            )}
          </Row>
        </div>
      </Card>

      {loading && !kernels.length && (
        <Card size="small" className="data-toolbar">
          <div style={{ textAlign: 'center', padding: 12 }}>
            <Space direction="vertical">
              <Spin size="large" />
              <Text>
                {sortBy === 'scoreAscending' || sortBy === 'scoreDescending'
                  ? '正在读取 Kaggle 公开分数榜，已缓存版本不会重复拉取分数...'
                  : `正在读取 Kernel，并补充前 ${scoreLimit} 条的公开分数...`}
              </Text>
              <Text type="secondary">已等待 {elapsedSeconds} 秒</Text>
            </Space>
          </div>
        </Card>
      )}

      {error && !loading && (
        <Alert
          type="error"
          showIcon
          closable
          message="查询未完成"
          description={error}
          action={<Button size="small" onClick={() => loadKernels(false)}>重试</Button>}
          onClose={() => setError(null)}
        />
      )}

      {!!selectedRowKeys.length && (
        <Alert
          type="info"
          showIcon
          message={`已选择 ${selectedRowKeys.length} 个 Kernel`}
          action={
            <Space>
              <Button size="small" onClick={() => setSelectedRowKeys([])}>取消</Button>
              <Button size="small" type="primary" icon={<CloudDownloadOutlined />} onClick={() => openArchiveDialog(selectedKernels)}>批量归档</Button>
            </Space>
          }
        />
      )}

      <Card className="data-panel desktop-data-table" styles={{ body: { padding: 0 } }}>
        <Table<ScoredKernel>
          columns={columns}
          dataSource={displayKernels}
          rowKey="ref"
          loading={loading}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{
            defaultPageSize: 25,
            pageSizeOptions: [10, 25, 50, 100],
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个 Kernel`,
          }}
          locale={{ emptyText: loading ? <Spin /> : <Empty description="暂无 Kernel 数据" /> }}
          scroll={{ x: 1080 }}
        />
      </Card>

      <div className="mobile-data-list" aria-label="Kernel 列表">
        {!displayKernels.length && !loading && (
          <div className="mobile-empty-state"><Empty description="暂无 Kernel 数据" /></div>
        )}
        {mobileKernels.map((kernel) => {
          const owner = kaggleOwnerFromRef(kernel.ref);
          const archived = archivedVersions.get(kernel.ref);
          const selected = selectedRowKeys.includes(kernel.ref);
          return (
            <article className="mobile-data-card" key={kernel.ref}>
              <div className="mobile-data-card-head">
                <Checkbox
                  checked={selected}
                  aria-label={`选择 ${kernel.ref}`}
                  onChange={(event) => setSelectedRowKeys((current) => (
                    event.target.checked
                      ? [...current, kernel.ref]
                      : current.filter((value) => value !== kernel.ref)
                  ))}
                />
                <div className="mobile-data-card-title">
                  <a className="kernel-title" href={kaggleKernelUrl(kernel.ref)} target="_blank" rel="noreferrer">
                    {kernel.title || kernel.ref}
                  </a>
                  <span className="kernel-ref">{kernel.ref}</span>
                </div>
                <span className="score-value" style={{ color: getScoreColor(kernel.public_score) }}>
                  {kernel.public_score === undefined || kernel.public_score === null
                    ? '—'
                    : kernel.public_score.toFixed(4)}
                </span>
              </div>
              <div className="mobile-data-card-meta">
                <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer">
                  <UserOutlined /> @{owner}
                </a>
                <span><StarOutlined /> {kernel.total_votes} 票</span>
                <span><ClockCircleOutlined /> {formatDate(kernel.last_run_time)}</span>
                {archived?.length
                  ? <Tag color="success">已归档 {archived.length} 个版本</Tag>
                  : <span>未归档</span>}
              </div>
              <div className="mobile-data-card-actions">
                <Button icon={<EyeOutlined />} onClick={() => showVersions(kernel)}>版本历史</Button>
                <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => openArchiveDialog([kernel])}>
                  归档
                </Button>
              </div>
            </article>
          );
        })}
        {displayKernels.length > MOBILE_PAGE_SIZE && (
          <div className="mobile-list-footer">
            <Text type="secondary">总计：{displayKernels.length}</Text>
            <Pagination
              simple
              size="small"
              current={mobilePage}
              pageSize={MOBILE_PAGE_SIZE}
              total={displayKernels.length}
              showSizeChanger={false}
              onChange={setMobilePage}
            />
          </div>
        )}
      </div>
      </div>

      <Modal
        title={
          <DialogTitle onClose={() => setVersionModalOpen(false)}>
            <Space>
              <span>{versionKernel ? `${versionKernel.ref} 版本历史` : '版本历史'}</span>
              {versionKernel && (
                <Tooltip title="检查是否有新版本；已缓存版本不会重复取分">
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={versionsLoading}
                    onClick={() => showVersions(versionKernel, true)}
                  >
                    检查新版本
                  </Button>
                </Tooltip>
              )}
            </Space>
          </DialogTitle>
        }
        open={versionModalOpen}
        closable={false}
        width={780}
        footer={null}
        onCancel={() => setVersionModalOpen(false)}
      >
        {versionsLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : versionsError ? (
          <Alert type="error" showIcon message="版本读取失败" description={versionsError} />
        ) : (
          <Table<VersionInfo>
            dataSource={versions}
            rowKey="version_number"
            size="small"
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            locale={{ emptyText: <Empty description="没有可用版本" /> }}
            columns={[
              { title: '版本', dataIndex: 'version_number', width: 75, render: (value) => <Text code>v{value}</Text> },
              {
                title: '标题',
                dataIndex: 'title',
                ellipsis: true,
                render: (value: string, record: VersionInfo) => (
                  <a
                    href={kaggleKernelVersionUrl(
                      versionKernel?.ref || '',
                      record.script_version_id,
                    )}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`在 Kaggle 打开版本 v${record.version_number}`}
                  >
                    <Space size={4}>
                      <span>{value || `版本 v${record.version_number}`}</span>
                      <ExportOutlined style={{ fontSize: 11 }} />
                    </Space>
                  </a>
                ),
              },
              { title: '状态', dataIndex: 'status', width: 110, render: renderVersionStatus },
              { title: '创建时间', dataIndex: 'date_created', width: 170, render: formatDate },
              { title: '分数', dataIndex: 'public_lb_numeric', width: 105, render: (value?: number) => value === undefined || value === null ? '—' : <Text strong>{value.toFixed(4)}</Text> },
              {
                title: '操作',
                width: 70,
                render: (_, record) => (
                  <Tooltip title="归档此版本">
                    <Button icon={<CloudDownloadOutlined />} aria-label={`归档版本 v${record.version_number}`} onClick={() => versionKernel && openArchiveDialog([versionKernel], record.version_number)} />
                  </Tooltip>
                ),
              },
            ]}
          />
        )}
      </Modal>

      <Modal
        title={(
          <DialogTitle
            disabled={archiveRunning}
            onClose={() => !archiveRunning && setArchiveModalOpen(false)}
          >
            {archiveTargets.length > 1 ? `批量归档 ${archiveTargets.length} 个 Kernel` : '归档 Kernel'}
          </DialogTitle>
        )}
        open={archiveModalOpen}
        closable={false}
        maskClosable={!archiveRunning}
        onCancel={() => !archiveRunning && setArchiveModalOpen(false)}
        footer={
          archiveCompleted ? (
            <Space>
              <Button onClick={() => setArchiveModalOpen(false)}>关闭</Button>
              <Button type="primary" onClick={() => navigate('/archives')}>查看归档</Button>
            </Space>
          ) : (
            <Space>
              <Button disabled={archiveRunning} onClick={() => setArchiveModalOpen(false)}>取消</Button>
              <Button type="primary" loading={archiveRunning} onClick={runArchive}>开始归档</Button>
            </Space>
          )
        }
      >
        {!archiveRunning && !archiveCompleted ? (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="目标">{archiveTargets.length === 1 ? archiveTargets[0]?.ref : `${archiveTargets.length} 个 Kernel`}</Descriptions.Item>
              <Descriptions.Item label="版本">
                {archiveTargets.length === 1 ? (
                  <Select
                    value={archiveVersionChoice}
                    onChange={(value) => setArchiveVersionChoice(value as ArchiveVersionChoice)}
                    options={archiveVersionOptions}
                    loading={archiveVersionsLoading}
                    disabled={archiveVersionsLoading}
                    style={{ width: '100%' }}
                  />
                ) : (
                  '每个 Kernel 自动选择最佳公开分数版本；无分数时选择最新版本'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="包含输出"><Switch checked={includeOutputs} onChange={setIncludeOutputs} /></Descriptions.Item>
            </Descriptions>
            {archiveVersionsError && archiveTargets.length === 1 && (
              <Alert type="warning" showIcon message="历史版本列表读取失败，仍可使用自动选择最佳版本。" description={archiveVersionsError} style={{ marginTop: 12 }} />
            )}
            {includeOutputs && <Alert type="warning" showIcon message="输出文件可能显著增加下载时间与本地占用。" style={{ marginTop: 12 }} />}
          </>
        ) : (
          <div style={{ padding: '8px 0 4px' }}>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text strong>{archiveCompleted ? '归档完成' : '正在归档'}</Text>
              <Text>{archiveSuccesses} 成功 · {archiveFailures.length} 失败</Text>
            </Space>
            <Progress percent={archiveProgress} status={archiveFailures.length ? 'exception' : archiveCompleted ? 'success' : 'active'} />
            {!!archiveFailures.length && (
              <Alert
                type="error"
                showIcon
                icon={<CloseCircleOutlined />}
                message="部分归档失败"
                description={archiveFailures.map((failure) => <div key={failure}>{failure}</div>)}
                style={{ marginTop: 12 }}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default KernelList;
