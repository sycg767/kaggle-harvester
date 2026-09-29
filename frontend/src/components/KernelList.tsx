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
import { type ScoredKernel } from '../api';
import { buildEnteredCompetitionOptions } from '../competitionOptions';
import { KernelVersionModal } from './KernelVersionModal';
import { KernelArchiveModal } from './KernelArchiveModal';
import { resolveScoreDirection, saveScoreDirection } from '../scoreDirection';
import { HARVESTER_EVENTS } from '../events';
import {
  DEFAULT_COMPETITION,
  isScoreSort,
  comparePublicScores,
  buildSortOptions,
  formatDate,
  renderVersionStatus,
  KernelFilterBar,
  KernelBatchBar,
  MobileKernelCardList,
  KernelMetricsCards,
  KernelFreshnessBanner,
  buildKernelTableColumns,
  useKernelArchive,
  useKernelVersions,
  useKernelListState,
} from './kernels';

const { Text } = Typography;

const KernelList: React.FC = () => {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const competitionInputRef = useRef<InputRef>(null);

  const {
    competitionInput,
    setCompetitionInput,
    competition,
    setCompetition,
    recentCompetitions,
    activeCompInfo,
    settingDefault,
    enteredCompetitions,
    enteredLoading,
    enteredError,
    sortBy,
    setSortBy,
    pageSize,
    setPageSize,
    maxPages,
    setMaxPages,
    scoreLimit,
    setScoreLimit,
    kernels,
    archives,
    setArchives,
    competitionInfo,
    setCompetitionInfo,
    confirmedDirection,
    setConfirmedDirection,
    loading,
    elapsedSeconds,
    error,
    setError,
    cacheInfo,
    backgroundRefreshing,
    loadKernels,
    loadEnteredCompetitions,
    togglePinActiveCompetition,
  } = useKernelListState();

  const [searchText, setSearchText] = useState('');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobilePage, setMobilePage] = useState(1);

  const directionResolution = resolveScoreDirection(competition, competitionInfo);

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

  useEffect(() => {
    const focusCompetition = () => {
      competitionInputRef.current?.focus({ cursor: 'all' });
    };
    window.addEventListener(HARVESTER_EVENTS.focusCompetition, focusCompetition);
    return () => window.removeEventListener(HARVESTER_EVENTS.focusCompetition, focusCompetition);
  }, []);

  const handleTogglePin = async () => {
    const res = await togglePinActiveCompetition();
    if (res.success) {
      message.success(res.message);
    } else {
      message.error(res.message);
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
    () =>
      buildEnteredCompetitionOptions(
        enteredCompetitions,
        [competition, ...recentCompetitions, DEFAULT_COMPETITION],
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
      String(option?.value || '').toLowerCase().includes(q) ||
      String(option?.label || '').toLowerCase().includes(q)
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
    return [...filtered].sort((left, right) =>
      comparePublicScores(left.public_score, right.public_score, sortBy, isLowerBetter),
    );
  }, [archivedOnly, archivedVersions, confirmedDirection, kernels, scoreFilter, searchText, sortBy]);

  useEffect(() => {
    setMobilePage(1);
  }, [archivedOnly, kernels, scoreFilter, searchText, sortBy]);

  const mobileKernels = useMemo(
    () => displayKernels.slice((mobilePage - 1) * 20, mobilePage * 20),
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
          togglePinActiveCompetition={handleTogglePin}
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
            style={{ marginBottom: 16 }}
            action={
              <Space>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    saveScoreDirection(competition, 'minimize');
                    setConfirmedDirection('minimize');
                    void loadKernels(true);
                  }}
                >
                  越低越好（误差类）
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    saveScoreDirection(competition, 'maximize');
                    setConfirmedDirection('maximize');
                    void loadKernels(true);
                  }}
                >
                  越高越好（准确率类）
                </Button>
              </Space>
            }
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
