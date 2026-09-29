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
  Table,
  Typography,
  theme,
  type InputRef,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  api,
  type ActiveCompetitionInfo,
  type ArchiveEntry,
  type CompetitionInfo,
  type EnteredCompetition,
  type KernelCacheInfo,
  type ScoredKernel,
} from '../api';
import { buildEnteredCompetitionOptions } from '../competitionOptions';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import { KernelVersionModal } from './KernelVersionModal';
import { KernelArchiveModal } from './KernelArchiveModal';
import { resolveScoreDirection, saveScoreDirection, type ScoreDirection } from '../scoreDirection';
import {
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
  readRecentCompetitions,
  formatDate,
  waitForRefreshPoll,
  renderVersionStatus,
  KernelFilterBar,
  KernelBatchBar,
  MobileKernelCardList,
  KernelMetricsCards,
  KernelFreshnessBanner,
  buildKernelTableColumns,
  useKernelArchive,
  useKernelVersions,
} from './kernels';

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

  const {
    versionModalOpen,
    setVersionModalOpen,
    versionKernel,
    versions,
    versionsLoading,
    versionsError,
    showVersions,
    closeVersionModal,
  } = useKernelVersions();

  const {
    archiveModalOpen,
    setArchiveModalOpen,
    archiveTargets,
    archiveVersionChoice,
    setArchiveVersionChoice,
    archiveVersionOptions,
    archiveVersionsLoading,
    archiveVersionsError,
    includeOutputs,
    setIncludeOutputs,
    archiveRunning,
    archiveCompleted,
    archiveProgress,
    archiveSuccesses,
    archiveFailures,
    openArchiveDialog,
    runArchive,
  } = useKernelArchive({
    confirmedDirection,
    competition,
    archives,
    setArchives,
    setSelectedRowKeys,
    onCloseVersionModal: closeVersionModal,
  });

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



  const selectedKernels = useMemo(() => {
    const selected = new Set(selectedRowKeys.map(String));
    return kernels.filter((kernel) => selected.has(kernel.ref));
  }, [kernels, selectedRowKeys]);

  const getScoreColor = (score?: number) => {
    if (score === undefined || score === null) return token.colorTextSecondary;
    if (bestScore !== null && Math.abs(score - bestScore) < 1e-9) return token.colorSuccess;
    return token.colorText;
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
    [confirmedDirection, getScoreColor, archivedVersions, token.colorWarning, showVersions, openArchiveDialog],
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
        <KernelMetricsCards
          kernelsCount={kernels.length}
          scoredCount={scoredKernels.length}
          bestScore={bestScore}
        />

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

        <KernelFreshnessBanner
          cacheInfo={cacheInfo}
          sortBy={sortBy}
          confirmedDirection={confirmedDirection}
          kernelsCount={kernels.length}
          backgroundRefreshing={backgroundRefreshing}
          directionSource={directionResolution.source}
        />

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
