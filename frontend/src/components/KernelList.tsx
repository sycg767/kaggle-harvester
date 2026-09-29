import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Space,
  Spin,
  Statistic,
  Table,
  Typography,
  theme,
  type InputRef,
} from 'antd';
import {
  CodeOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
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
import { KernelVersionModal } from './KernelVersionModal';
import { KernelArchiveModal } from './KernelArchiveModal';
import { resolveScoreDirection, saveScoreDirection, type ScoreDirection } from '../scoreDirection';
import {
  dispatchArchivesChanged,
  dispatchCompetitionChanged,
  dispatchDefaultCompetitionChanged,
  HARVESTER_EVENTS,
} from '../events';
import {
  DEFAULT_COMPETITION,
  RECENT_COMPETITIONS_KEY,
  MOBILE_PAGE_SIZE,
  SCORE_SORT_BEST,
  isScoreSort,
  resolveApiScoreSort,
  comparePublicScores,
  buildSortOptions,
  type ArchiveVersionChoice,
  readRecentCompetitions,
  formatDate,
  formatCacheAge,
  scoreDirectionSourceLabel,
  waitForRefreshPoll,
  renderVersionStatus,
} from './kernels/kernelUtils';
import KernelFilterBar from './kernels/KernelFilterBar';
import KernelBatchBar from './kernels/KernelBatchBar';
import MobileKernelCardList from './kernels/MobileKernelCardList';
import { buildKernelTableColumns } from './kernels/kernelTableColumns';

const { Text } = Typography;

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

  const columns = useMemo(
    () =>
      buildKernelTableColumns({
        confirmedDirection,
        getScoreColor,
        archivedVersions,
        warningColor: token.colorWarning,
        onShowVersions: showVersions,
        onOpenArchive: openArchiveDialog,
      }),
    [confirmedDirection, getScoreColor, archivedVersions, token.colorWarning],
  );

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

        <KernelFilterBar
          competitionInput={competitionInput}
          setCompetitionInput={setCompetitionInput}
          competitionInputRef={competitionInputRef}
          competitionOptions={competitionOptions}
          filterCompetitionOption={filterCompetitionOption}
          enteredLoading={enteredLoading}
          enteredError={enteredError}
          enteredCompetitions={enteredCompetitions}
          competition={competition}
          activeCompInfo={activeCompInfo}
          settingDefault={settingDefault}
          togglePinActiveCompetition={togglePinActiveCompetition}
          loadEnteredCompetitions={loadEnteredCompetitions}
          loadKernels={loadKernels}
          searchText={searchText}
          setSearchText={setSearchText}
          sortBy={sortBy}
          setSortBy={setSortBy}
          sortOptions={buildSortOptions(confirmedDirection !== 'maximize')}
          loading={loading}
          mobileFiltersOpen={mobileFiltersOpen}
          setMobileFiltersOpen={setMobileFiltersOpen}
          scoreFilter={scoreFilter}
          setScoreFilter={setScoreFilter}
          archivedOnly={archivedOnly}
          setArchivedOnly={setArchivedOnly}
          kernelsCount={kernels.length}
          scoredCount={scoredKernels.length}
          displayCount={displayKernels.length}
          cacheInfo={cacheInfo}
          backgroundRefreshing={backgroundRefreshing}
          competitionInfo={competitionInfo}
          confirmedDirection={confirmedDirection}
          pageSize={pageSize}
          setPageSize={setPageSize}
          maxPages={maxPages}
          setMaxPages={setMaxPages}
          scoreLimit={scoreLimit}
          setScoreLimit={setScoreLimit}
        />

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

      <KernelBatchBar
        selectedCount={selectedRowKeys.length}
        selectedKernels={selectedKernels}
        onClearSelection={() => setSelectedRowKeys([])}
        onBatchArchive={openArchiveDialog}
      />

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

      <MobileKernelCardList
        displayKernels={displayKernels}
        mobileKernels={mobileKernels}
        loading={loading}
        selectedRowKeys={selectedRowKeys}
        archivedVersions={archivedVersions}
        mobilePage={mobilePage}
        onPageChange={setMobilePage}
        onToggleSelect={(ref, checked) =>
          setSelectedRowKeys((current) =>
            checked ? [...current, ref] : current.filter((val) => val !== ref),
          )
        }
        getScoreColor={getScoreColor}
        onShowVersions={showVersions}
        onOpenArchive={openArchiveDialog}
      />
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
