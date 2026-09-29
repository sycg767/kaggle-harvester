import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  App as AntApp,
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
  StarFilled,
  StarOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Filter } from 'lucide-react';
import {
  api,
  type ActiveCompetitionInfo,
  type ArchiveEntry,
  type CompetitionInfo,
  type EnteredCompetition,
  type KernelCacheInfo,
  type ScoredKernel,
  type VersionInfo,
} from '../api';
import { buildEnteredCompetitionOptions } from '../competitionOptions';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleKernelVersionUrl,
  kaggleOwnerFromRef,
} from '../kaggleUrls';
import DialogTitle from './DialogTitle';
import CopyButton from './CopyButton';
import { KernelVersionModal } from './KernelVersionModal';
import { KernelArchiveModal } from './KernelArchiveModal';
import { resolveScoreDirection, saveScoreDirection, type ScoreDirection } from '../scoreDirection';
import {
  dispatchArchivesChanged,
  dispatchCompetitionChanged,
  dispatchDefaultCompetitionChanged,
  HARVESTER_EVENTS,
} from '../events';

const { Text } = Typography;
const DEFAULT_COMPETITION = 'biohub-cell-tracking-during-development';
const RECENT_COMPETITIONS_KEY = 'harvester.recentCompetitions';
const MOBILE_PAGE_SIZE = 10;
/** UI 里 scoreAscending = 最佳优先，scoreDescending = 倒序；真正 API 方向按竞赛 metric 映射。 */
const SCORE_SORT_BEST = 'scoreAscending';
const SCORE_SORT_REVERSE = 'scoreDescending';

const isScoreSort = (value: string) =>
  value === SCORE_SORT_BEST || value === SCORE_SORT_REVERSE;

/** 把「最佳优先 / 倒序」映射为 Kaggle 数值升序或降序。 */
const resolveApiScoreSort = (sortBy: string, isLowerBetter: boolean): string => {
  if (!isScoreSort(sortBy)) return sortBy;
  const bestFirst = sortBy === SCORE_SORT_BEST;
  if (isLowerBetter) {
    return bestFirst ? 'scoreAscending' : 'scoreDescending';
  }
  return bestFirst ? 'scoreDescending' : 'scoreAscending';
};

/** 本地按公开分重排：最佳优先始终把更好的分数排在前面。 */
const comparePublicScores = (
  leftScore: number | null | undefined,
  rightScore: number | null | undefined,
  sortBy: string,
  isLowerBetter: boolean,
): number => {
  if (leftScore === undefined || leftScore === null) return 1;
  if (rightScore === undefined || rightScore === null) return -1;
  const bestFirst = sortBy === SCORE_SORT_BEST;
  const numericAscending = isLowerBetter ? bestFirst : !bestFirst;
  const delta = leftScore - rightScore;
  return numericAscending ? delta : -delta;
};

const buildSortOptions = (isLowerBetter: boolean) => [
  {
    value: SCORE_SORT_BEST,
    label: isLowerBetter
      ? '公开分数 · 最佳优先（低→高）'
      : '公开分数 · 最佳优先（高→低）',
  },
  {
    value: SCORE_SORT_REVERSE,
    label: isLowerBetter
      ? '公开分数 · 倒序（高→低）'
      : '公开分数 · 倒序（低→高）',
  },
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

const scoreDirectionSourceLabel = (source?: CompetitionInfo['score_direction_source'] | 'user' | 'unknown') => ({
  api: '竞赛 API',
  leaderboard: '公开排行榜',
  metric: '评价指标推断',
  fallback: '兼容默认值',
  user: '用户确认',
  unknown: '未确认',
}[source || 'unknown']);

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
  const { message } = AntApp.useApp();
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
  const [activeCompInfo, setActiveCompInfo] = useState<ActiveCompetitionInfo | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);
  const [enteredCompetitions, setEnteredCompetitions] = useState<EnteredCompetition[]>([]);
  const [enteredLoading, setEnteredLoading] = useState(false);
  const [enteredError, setEnteredError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState(SCORE_SORT_BEST);
  const [pageSize, setPageSize] = useState(50);
  const [maxPages, setMaxPages] = useState(1);
  const [scoreLimit, setScoreLimit] = useState(50);
  const [kernels, setKernels] = useState<ScoredKernel[]>([]);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [competitionInfo, setCompetitionInfo] = useState<CompetitionInfo | null>(null);
  const [confirmedDirection, setConfirmedDirection] = useState<ScoreDirection | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<KernelCacheInfo | null>(null);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const directionResolution = resolveScoreDirection(competition, competitionInfo);
  const [searchText, setSearchText] = useState('');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [archivedOnly, setArchivedOnly] = useState(false);
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
  const [includeOutputs, setIncludeOutputs] = useState(false);
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
      const scoreSorted = isScoreSort(sortBy);
      // 分数榜必须先知道「越高/越低越好」，才能把「最佳优先」映射到正确的 API 排序。
      const comp = await api
        .getCompetition(nextCompetition, { signal: controller.signal })
        .catch(() => null);
      if (controller.signal.aborted || requestSequence !== requestSequenceRef.current) return;
      setCompetitionInfo(comp);
      const resolvedDirection = resolveScoreDirection(nextCompetition, comp);
      setConfirmedDirection(resolvedDirection.direction);
      const isLowerBetter = resolvedDirection.direction === 'minimize';
      const apiSortBy = scoreSorted && !resolvedDirection.direction
        ? 'hotness'
        : resolveApiScoreSort(sortBy, isLowerBetter);
      const queryParams = {
        competition: nextCompetition,
        sort_by: apiSortBy,
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

      const archiveData = await api
        .listArchives(nextCompetition, controller.signal)
        .catch(() => []);
      if (controller.signal.aborted || requestSequence !== requestSequenceRef.current) return;
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

  const loadEnteredCompetitions = async (refresh = false) => {
    setEnteredLoading(true);
    setEnteredError(null);
    try {
      const items = await getEnteredCompetitions({ refresh });
      setEnteredCompetitions(items);
      if (!items.length) {
        setEnteredError('未获取到已参加竞赛，可手输 slug 或点刷新。');
      }
    } catch (error) {
      setEnteredError(error instanceof Error ? error.message : '已参加竞赛列表读取失败。');
    } finally {
      setEnteredLoading(false);
    }
  };

  useEffect(() => {
    void loadEnteredCompetitions(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    void api.getActiveCompetition().then((info) => {
      if (mounted) setActiveCompInfo(info);
    }).catch(() => null);

    const handleDefaultChanged = () => {
      void api.getActiveCompetition().then((info) => {
        if (mounted) setActiveCompInfo(info);
      }).catch(() => null);
    };
    window.addEventListener(HARVESTER_EVENTS.defaultCompetitionChanged, handleDefaultChanged);
    return () => {
      mounted = false;
      window.removeEventListener(HARVESTER_EVENTS.defaultCompetitionChanged, handleDefaultChanged);
    };
  }, []);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  useEffect(() => {
    const focusCompetition = () => {
      competitionInputRef.current?.focus({ cursor: 'all' });
    };
    window.addEventListener(HARVESTER_EVENTS.focusCompetition, focusCompetition);
    return () => window.removeEventListener(HARVESTER_EVENTS.focusCompetition, focusCompetition);
  }, []);

  const togglePinActiveCompetition = async () => {
    const targetComp = competition.trim();
    if (!targetComp) return;
    setSettingDefault(true);
    try {
      const isCurrentPinned = activeCompInfo?.competition === targetComp && activeCompInfo?.is_pinned;
      if (isCurrentPinned) {
        const res = await api.deleteActiveCompetition();
        setActiveCompInfo(res);
        dispatchDefaultCompetitionChanged(res.competition);
        message.success(`已恢复智能推荐默认赛事（当前智能推荐：${res.competition}）`);
      } else {
        const res = await api.setActiveCompetition(targetComp);
        setActiveCompInfo(res);
        dispatchDefaultCompetitionChanged(res.competition);
        message.success(`已将「${competitionInfo?.title || targetComp}」设为全站主攻赛事，所有设备同步生效！`);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '设置默认竞赛失败。');
    } finally {
      setSettingDefault(false);
    }
  };

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
    () => buildEnteredCompetitionOptions(
      enteredCompetitions,
      [
        competition,
        ...recentCompetitions,
        DEFAULT_COMPETITION,
      ],
      {
        activeSlug: activeCompInfo?.competition,
        currentSlug: competition,
        excludeEnded: true,
      },
    ),
    [competition, enteredCompetitions, recentCompetitions, activeCompInfo?.competition],
  );

  const competitionOptionValues = useMemo(
    () => new Set(competitionOptions.map((item) => item.value.toLowerCase())),
    [competitionOptions],
  );

  /** 输入为空或已是完整 slug 时展示全部选项，便于切换竞赛。 */
  const filterCompetitionOption = (
    inputValue: string,
    option?: { value?: string | number; label?: React.ReactNode },
  ) => {
    const q = inputValue.trim().toLowerCase();
    if (!q || competitionOptionValues.has(q)) return true;
    return (
      String(option?.value || '').toLowerCase().includes(q)
      || String(option?.label || '').toLowerCase().includes(q)
    );
  };

  const displayKernels = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const filtered = kernels.filter((kernel) => {
      const hasScore = kernel.public_score !== undefined && kernel.public_score !== null;
      if (scoreFilter === 'scored' && !hasScore) return false;
      if (scoreFilter === 'unscored' && hasScore) return false;
      if (archivedOnly) {
        const archivedList = archivedVersions.get(kernel.ref);
        if (!archivedList || !archivedList.length) return false;
      }
      if (!query) return true;
      return [kernel.ref, kernel.title, kernel.author]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });

    if (!isScoreSort(sortBy)) return filtered;

    if (!confirmedDirection) return filtered;
    const isLowerBetter = confirmedDirection === 'minimize';
    return [...filtered].sort((left, right) => comparePublicScores(
      left.public_score,
      right.public_score,
      sortBy,
      isLowerBetter,
    ));
  }, [archivedOnly, archivedVersions, confirmedDirection, kernels, scoreFilter, searchText, sortBy]);

  useEffect(() => {
    setMobilePage(1);
  }, [archivedOnly, kernels, scoreFilter, searchText, sortBy]);

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
    if (!confirmedDirection) return null;
    return confirmedDirection === 'maximize' ? Math.max(...scores) : Math.min(...scores);
  }, [confirmedDirection, scoredKernels]);

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
      if (confirmedDirection === 'maximize') {
        return currentScore > bestScoreValue ? version : best;
      }
      return currentScore < bestScoreValue ? version : best;
    });
  }, [archiveLatestVersion, archiveVersions, confirmedDirection]);

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
    if (!confirmedDirection) {
      message.warning('请先确认该竞赛的分数方向，再选择最佳版本归档。');
      return;
    }
    if (version !== undefined) setVersionModalOpen(false);
    setArchiveTargets(targets);
    setArchiveVersionChoice(version === undefined ? 'best' : `version:${version}`);
    setArchiveVersions([]);
    setArchiveVersionsError(null);
    setIncludeOutputs(false);
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
    const archiveDirection = confirmedDirection;
    if (!archiveDirection) {
      message.error('分数方向尚未确认，无法执行归档。');
      return;
    }
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
          score_direction: archiveDirection,
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
      sorter: (a, b) => {
        const isLowerBetter = confirmedDirection === 'minimize';
        // 表头点击：第一次按「最佳优先」，再点则倒序。
        return comparePublicScores(
          a.public_score,
          b.public_score,
          SCORE_SORT_BEST,
          isLowerBetter,
        );
      },
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
          <Button
            icon={<ReloadOutlined />}
            aria-label={isScoreSort(sortBy) ? '刷新分数榜' : '强制刷新'}
            loading={loading}
            onClick={() => loadKernels(true)}
          >
            {isScoreSort(sortBy) ? '刷新分数榜' : '强制刷新'}
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
          {/* 竞赛切换 */}
          <Col xs={24} md={8} lg={8} className="toolbar-competition-control">
            <Space.Compact style={{ width: '100%' }}>
              <AutoComplete
                className="overview-competition-select"
                style={{ width: '100%' }}
                value={competitionInput}
                options={competitionOptions}
                onChange={setCompetitionInput}
                onSelect={(value) => {
                  const next = String(value);
                  setCompetitionInput(next);
                  void loadKernels(false, next);
                }}
                filterOption={filterCompetitionOption}
                defaultActiveFirstOption={false}
                notFoundContent={
                  enteredLoading
                    ? '加载已参加竞赛…'
                    : enteredError || '无匹配竞赛，可直接输入 slug'
                }
              >
                <Input
                  ref={competitionInputRef}
                  aria-label="选择或输入 Kaggle 竞赛标识"
                  prefix={<TrophyOutlined />}
                  suffix={enteredLoading ? <LoadingOutlined spin /> : undefined}
                  placeholder={
                    enteredCompetitions.length
                      ? `已参加 ${enteredCompetitions.length} 个 · 点选或输入`
                      : '加载已参加竞赛 / 输入 slug'
                  }
                  onPressEnter={() => loadKernels(false)}
                />
              </AutoComplete>
              <Tooltip title="刷新已参加竞赛列表">
                <Button
                  icon={<ReloadOutlined />}
                  loading={enteredLoading}
                  aria-label="刷新已参加竞赛"
                  onClick={() => void loadEnteredCompetitions(true)}
                />
              </Tooltip>
              <Tooltip
                title={
                  activeCompInfo?.competition === competition && activeCompInfo?.is_pinned
                    ? '当前竞赛已设为「全站主攻赛事」。点击取消。'
                    : '设为全站主攻赛事'
                }
              >
                <Button
                  icon={
                    activeCompInfo?.competition === competition && activeCompInfo?.is_pinned ? (
                      <StarFilled style={{ color: '#faad14' }} />
                    ) : activeCompInfo?.competition === competition ? (
                      <StarOutlined style={{ color: '#faad14' }} />
                    ) : (
                      <StarOutlined />
                    )
                  }
                  loading={settingDefault}
                  aria-label="设为全站默认主攻赛事"
                  onClick={togglePinActiveCompetition}
                >
                  {activeCompInfo?.competition === competition && activeCompInfo?.is_pinned
                    ? '主攻'
                    : undefined}
                </Button>
              </Tooltip>
            </Space.Compact>
          </Col>

          {/* 实时本地关键词过滤 */}
          <Col xs={24} md={7} lg={7}>
            <Input
              allowClear
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
              placeholder="过滤当前 Notebook 标题、作者..."
              aria-label="过滤当前 Notebook"
            />
          </Col>

          {/* 排序方式 */}
          <Col xs={14} md={5} lg={5} className="desktop-sort-control">
            <Select
              aria-label="Kernel 排序方式"
              value={sortBy}
              onChange={setSortBy}
              style={{ width: '100%' }}
              options={buildSortOptions(confirmedDirection !== 'maximize')}
            />
          </Col>

          {/* 快捷操作与高级展开 */}
          <Col xs={10} md={4} lg={4} style={{ textAlign: 'right' }}>
            <Space size={4}>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                loading={loading}
                onClick={() => loadKernels(false)}
                title="重新向 Kaggle 检索榜单"
              >
                查询
              </Button>
              <Button
                icon={<Filter size={14} />}
                onClick={() => setMobileFiltersOpen((curr) => !curr)}
                title="高级设置 (分页与取分限制)"
              >
                高级
              </Button>
            </Space>
          </Col>
        </Row>

        {/* 快捷过滤 Pills 与状态指示 */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <Space size={6} wrap>
            <span style={{ fontSize: 12, color: '#64748b' }}>过滤:</span>
            <Button
              size="small"
              type={scoreFilter === 'all' && !archivedOnly ? 'primary' : 'default'}
              onClick={() => { setScoreFilter('all'); setArchivedOnly(false); }}
              style={{ borderRadius: 12, fontSize: 11 }}
            >
              全部 ({kernels.length})
            </Button>
            <Button
              size="small"
              type={scoreFilter === 'scored' && !archivedOnly ? 'primary' : 'default'}
              onClick={() => { setScoreFilter('scored'); setArchivedOnly(false); }}
              style={{ borderRadius: 12, fontSize: 11 }}
            >
              🔥 仅看有分 ({scoredKernels.length})
            </Button>
            <Button
              size="small"
              type={archivedOnly ? 'primary' : 'default'}
              onClick={() => setArchivedOnly((curr) => !curr)}
              style={{ borderRadius: 12, fontSize: 11 }}
            >
              💾 仅看本地已归档
            </Button>
          </Space>

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
            {competitionInfo && confirmedDirection && (
              <Tooltip title={competitionInfo.score_direction_source === 'fallback' ? '该方向由你确认并保存在当前浏览器' : '已根据竞赛信息或公开榜单识别'}>
                <Tag color={competitionInfo.score_direction_source === 'fallback' ? 'cyan' : 'blue'}>
                  {confirmedDirection === 'minimize' ? '越低越好' : '越高越好'}
                </Tag>
              </Tooltip>
            )}
            <Text type="secondary" className="kernel-score-count">匹配 {displayKernels.length}/{kernels.length} 条</Text>
          </Space>
        </div>

        {/* 高级配置折叠区 */}
        <div className={`toolbar-advanced${mobileFiltersOpen ? ' is-open' : ''}`}>
          <div className="toolbar-divider" />
          <Row gutter={[8, 8]} align="middle">
            <Col xs={24} md={6}>
              <Select
                aria-label="分数筛选"
                value={scoreFilter}
                onChange={setScoreFilter}
                style={{ width: '100%' }}
                options={[
                  { value: 'all', label: '全部分数' },
                  { value: 'scored', label: '已有分数' },
                  { value: 'unscored', label: '暂无分数' },
                ]}
              />
            </Col>
            {!isScoreSort(sortBy) && (
              <>
                <Col xs={12} md={6}>
                  <InputNumber aria-label="每页 Kernel 数量" min={10} max={200} step={10} value={pageSize} onChange={(value) => setPageSize(value || 50)} style={{ width: '100%' }} addonBefore="每页" />
                </Col>
                <Col xs={12} md={6}>
                  <InputNumber aria-label="读取页数" min={1} max={10} value={maxPages} onChange={(value) => setMaxPages(value || 1)} style={{ width: '100%' }} addonBefore="页数" />
                </Col>
                <Col xs={24} md={6}>
                  <Select aria-label="读取分数数量" value={scoreLimit} onChange={setScoreLimit} style={{ width: '100%' }} options={[10, 20, 30, 50].map((value) => ({ value, label: `读取前 ${value} 条分数` }))} />
                </Col>
              </>
            )}
          </Row>
        </div>
      </Card>

      {competitionInfo?.score_direction_source === 'fallback' && !confirmedDirection && (
        <Alert
          type="warning"
          showIcon
          message="需要确认分数方向"
          description="Kaggle 未返回可靠的优化方向。确认后才能按最佳分数排序和归档最佳版本。"
          action={(
            <Space wrap>
              <Button size="small" onClick={() => {
                saveScoreDirection(competition, 'minimize');
                setConfirmedDirection('minimize');
                void loadKernels(false);
              }}>越低越好</Button>
              <Button size="small" onClick={() => {
                saveScoreDirection(competition, 'maximize');
                setConfirmedDirection('maximize');
                void loadKernels(false);
              }}>越高越好</Button>
            </Space>
          )}
        />
      )}

      {cacheInfo && (
        <div className={`data-freshness${cacheInfo.refresh_state === 'failed' ? ' is-error' : ''}`} role="status">
          <div>
            <strong>数据范围</strong>
            <span>{isScoreSort(sortBy) && confirmedDirection ? '公开分数榜前 50 条' : `当前查询 ${kernels.length} 条`}</span>
          </div>
          <div>
            <strong>快照时间</strong>
            <span>{cacheInfo.fetched_at ? formatDate(new Date(cacheInfo.fetched_at * 1000).toISOString()) : formatCacheAge(cacheInfo.age_seconds)}</span>
          </div>
          <div>
            <strong>数据状态</strong>
            <span>{cacheInfo.refresh_state === 'failed' ? '后台刷新失败，正在展示旧数据' : backgroundRefreshing ? '旧数据可用，后台更新中' : cacheInfo.state === 'STALE' ? '正在展示旧数据' : '快照可用'}</span>
          </div>
          <div>
            <strong>方向来源</strong>
            <span>{scoreDirectionSourceLabel(directionResolution.source)}</span>
          </div>
        </div>
      )}

      {loading && !kernels.length && (
        <Card size="small" className="data-toolbar">
          <div style={{ textAlign: 'center', padding: 12 }}>
            <Space direction="vertical">
              <Spin size="large" />
              <Text>
                {isScoreSort(sortBy)
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
        <div
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            background: '#ffffff',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.15)',
            border: '1px solid #d9d9d9',
            borderRadius: 24,
            padding: '8px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <Text strong>
            已选择 <span style={{ color: '#1677ff' }}>{selectedRowKeys.length}</span> 个 Kernel
          </Text>
          <Space>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>
              取消选择
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<CloudDownloadOutlined />}
              onClick={() => openArchiveDialog(selectedKernels)}
            >
              批量归档
            </Button>
          </Space>
        </div>
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
                  <span className="kernel-ref-line"><span className="kernel-ref">{kernel.ref}</span><CopyButton value={kernel.ref} label="复制 Kernel ref" /></span>
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

      <KernelVersionModal
        open={versionModalOpen}
        onClose={() => setVersionModalOpen(false)}
        versionKernel={versionKernel}
        versions={versions}
        versionsLoading={versionsLoading}
        versionsError={versionsError || ''}
        onCheckNewVersions={(kernel) => showVersions(kernel, true)}
        onArchiveVersion={(kernel, versionNum) => openArchiveDialog([kernel], versionNum)}
        formatDate={formatDate}
        renderVersionStatus={renderVersionStatus}
      />

      <KernelArchiveModal
        open={archiveModalOpen}
        archiveRunning={archiveRunning}
        archiveCompleted={archiveCompleted}
        archiveTargets={archiveTargets}
        archiveVersionChoice={archiveVersionChoice}
        archiveVersionOptions={archiveVersionOptions}
        archiveVersionsLoading={archiveVersionsLoading}
        archiveVersionsError={archiveVersionsError || ''}
        includeOutputs={includeOutputs}
        archiveSuccesses={archiveSuccesses}
        archiveFailures={archiveFailures}
        archiveProgress={archiveProgress}
        onClose={() => setArchiveModalOpen(false)}
        onNavigateArchives={() => navigate('/archives')}
        onRunArchive={runArchive}
        onVersionChoiceChange={setArchiveVersionChoice}
        onIncludeOutputsChange={setIncludeOutputs}
      />
    </div>
  );
};

export default KernelList;
