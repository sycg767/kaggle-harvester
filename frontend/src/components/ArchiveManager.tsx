import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Modal,
  Table,
  Select,
  Tag,
} from 'antd';
import {
  ExportOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { api, type ArchiveEntry, type ArchiveFile } from '../api';
import ArchiveJobsPanel from './ArchiveJobsPanel';
import { studyOptions, type ArchiveStudy } from '../archiveStudyApi';
import { dispatchArchivesChanged, HARVESTER_EVENTS } from '../events';
import {
  type ArchiveMetadata,
  ArchiveBatchBar,
  ArchiveDetailModal,
  ArchiveFilterBar,
  ArchiveMetricsCards,
  createArchiveTableColumns,
  exportArchiveListCsv,
  formatBytes,
  MobileArchiveCardList,
} from './archive-manager';

const MOBILE_PAGE_SIZE = 10;

const ArchiveManager: React.FC = () => {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [studyFilter, setStudyFilter] = useState('all');
  const [studyErrors, setStudyErrors] = useState<Record<string, string>>({});
  const [studies, setStudies] = useState<Record<string, ArchiveStudy>>({});
  const detailRequest = useRef(0);
  const deepLinkOpened = useRef('');
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [competitionFilter, setCompetitionFilter] = useState('all');
  const [scoredOnly, setScoredOnly] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [mobilePage, setMobilePage] = useState(1);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailArchive, setDetailArchive] = useState<ArchiveEntry | null>(null);
  const [detailMetadata, setDetailMetadata] = useState<ArchiveMetadata | null>(null);
  const [detailFiles, setDetailFiles] = useState<ArchiveFile[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadArchives = async () => {
    setLoading(true);
    setError(null);
    try {
      const entries = await api.listArchives() as (ArchiveEntry & { study?: ArchiveStudy; study_error?: string })[];
      setArchives(entries);
      setListLoaded(true);
      setStudies(Object.fromEntries(entries.filter(item => item.study && !item.study_error).map(item => [item.id, item.study!])));
      setStudyErrors(Object.fromEntries(entries.filter(item => item.study_error).map(item => [item.id, item.study_error!])));

    } catch (err) {
      setError(err instanceof Error ? err.message : '归档列表加载失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadArchives();
    const refresh = () => void loadArchives();
    window.addEventListener(HARVESTER_EVENTS.archivesChanged, refresh);
    return () => window.removeEventListener(HARVESTER_EVENTS.archivesChanged, refresh);
  }, []);

  const competitions = useMemo(
    () => [...new Set(archives.map((archive) => archive.competition).filter(Boolean) as string[])].sort(),
    [archives],
  );

  const displayArchives = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return archives.filter((archive) => {
      if (studyFilter !== 'all' && (studyErrors[archive.id] ? 'unavailable' : studies[archive.id]?.status || 'unread') !== studyFilter) return false;
      if (competitionFilter !== 'all' && archive.competition !== competitionFilter) return false;
      if (scoredOnly && (archive.public_score === undefined || archive.public_score === null)) return false;
      if (!query) return true;
      return [archive.ref, archive.title, archive.author, archive.path, archive.competition || '', ...(studies[archive.id]?.tags || []), studies[archive.id]?.notes || '']
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [archives, competitionFilter, scoredOnly, searchText, studyFilter, studies, studyErrors]);

  useEffect(() => {
    setMobilePage(1);
  }, [archives, competitionFilter, scoredOnly, searchText, studyFilter, studies, studyErrors]);

  const mobileArchives = useMemo(
    () => displayArchives.slice((mobilePage - 1) * MOBILE_PAGE_SIZE, mobilePage * MOBILE_PAGE_SIZE),
    [displayArchives, mobilePage],
  );

  useEffect(() => { setSelectedRowKeys([]); }, [competitionFilter, studyFilter, scoredOnly, searchText]);

  const selectedArchives = useMemo(() => {
    const selected = new Set(selectedRowKeys.map(String));
    return archives.filter((archive) => selected.has(archive.id));
  }, [archives, selectedRowKeys]);

  const uniqueKernels = new Set(archives.map((archive) => archive.ref)).size;
  const uniqueAuthors = new Set(archives.map((archive) => archive.author)).size;
  const totalSize = archives.reduce((sum, archive) => sum + (archive.size_bytes || 0), 0);

  const showDetail = async (archive: ArchiveEntry) => {
    const requestId = ++detailRequest.current;
    setDetailArchive(archive);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailMetadata(null);
    setDetailFiles([]);
    setDetailError(null);
    try {
      const [metadata, files] = await Promise.all([
        api.getArchiveMetadata(archive.id),
        api.getArchiveFiles(archive.id),
      ]);
      if (requestId !== detailRequest.current) return;
      setDetailMetadata(metadata as ArchiveMetadata);
      setDetailFiles(files);
    } catch (err) {
      if (requestId !== detailRequest.current) return;
      setDetailError(err instanceof Error ? err.message : '归档详情加载失败。');
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  };

  useEffect(() => {
    const id = searchParams.get('archive');
    if (!id || deepLinkOpened.current === id) return;
    const archive = archives.find(item => item.id === id);
    if (archive) { deepLinkOpened.current = id; void showDetail(archive); }
  }, [archives, searchParams]);

  const closeDetail = () => {
    detailRequest.current += 1;
    setDetailOpen(false);
    if (searchParams.has('archive')) { const next = new URLSearchParams(searchParams); next.delete('archive'); setSearchParams(next, { replace: true }); }
    deepLinkOpened.current = '';
  };

  const downloadSource = async (archive: ArchiveEntry) => {
    try {
      const blob = await api.getArchiveSource(archive.id);
      const extension = archive.source_file?.split('.').pop() || 'ipynb';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${archive.ref.replace('/', '__')}__v${archive.version_number}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '源文件下载失败。');
    }
  };

  const deleteArchives = (targets: ArchiveEntry[]) => {
    if (!targets.length) return;
    Modal.confirm({
      title: targets.length === 1 ? '删除这个归档版本？' : `删除 ${targets.length} 个归档版本？`,
      content: '对应服务器上的文件会一并删除，此操作无法撤销。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const failures: string[] = [];
        for (const archive of targets) {
          try {
            await api.deleteArchive(archive.id);
          } catch {
            failures.push(archive.ref);
          }
        }
        dispatchArchivesChanged();
        setSelectedRowKeys([]);
        if (failures.length) {
          message.error(`${failures.length} 个归档删除失败`);
        } else {
          message.success('归档已删除');
        }
      },
    });
  };

  const columns = useMemo(
    () =>
      [...createArchiveTableColumns({
        onShowDetail: (rec) => void showDetail(rec),
        onDownloadSource: (rec) => void downloadSource(rec),
        onDeleteArchives: (records) => deleteArchives(records),
      }), { title: '研究状态', key: 'study', width: 155, render: (_: unknown, rec: ArchiveEntry) => <Tag color={studyErrors[rec.id] ? 'error' : undefined}>{studyErrors[rec.id] ? '状态无法读取' : studyOptions.find(option => option.value === (studies[rec.id]?.status || 'unread'))?.label}</Tag> }],
    [studies, studyErrors],
  );

  return (
    <div className="page-shell archive-page">
      <header className="archive-page-header">
        <div className="archive-title-wrap">
          <h1 className="archive-title">归档与研究</h1>
          <span className="archive-subtitle">{archives.length} 个版本 · {formatBytes(totalSize)}</span>
        </div>
        <div className="archive-header-actions">
          <Button
            className="archive-header-btn"
            icon={<ExportOutlined />}
            aria-label="导出清单"
            disabled={!displayArchives.length}
            onClick={() => exportArchiveListCsv(displayArchives)}
          >
            <span className="archive-btn-text">导出清单</span>
          </Button>
          <Button
            className="archive-header-btn"
            icon={<ReloadOutlined />}
            aria-label="刷新归档"
            loading={loading}
            onClick={() => void loadArchives()}
          >
            <span className="archive-btn-text">刷新</span>
          </Button>
        </div>
      </header>

      <div className="page-content archive-page-content">
        <p>归档保存在应用服务器；下载源文件可保存到你的电脑。通过阅读、笔记和版本比较记录研究进展。</p>
        <ArchiveJobsPanel competition={competitionFilter === 'all' ? undefined : competitionFilter} />
        <ArchiveMetricsCards
          totalArchives={archives.length}
          uniqueKernels={uniqueKernels}
          uniqueAuthors={uniqueAuthors}
          totalSize={totalSize}
        />

        <ArchiveFilterBar
          searchText={searchText}
          setSearchText={setSearchText}
          competitionFilter={competitionFilter}
          setCompetitionFilter={setCompetitionFilter}
          scoredOnly={scoredOnly}
          setScoredOnly={setScoredOnly}
          competitions={competitions}
          archives={archives}
          displayCount={displayArchives.length}
        />

        {Object.keys(studyErrors).length > 0 && <Alert type="error" showIcon message="研究记录无法读取，已暂停状态分类" description={[...new Set(Object.values(studyErrors))].join(' ')} style={{ marginBottom: 16 }} />}
        <Select aria-label="按研究状态筛选" value={studyFilter} onChange={setStudyFilter} style={{ width: 240, marginBottom: 16 }} options={[{ value: 'all', label: '全部研究状态' }, ...studyOptions, ...(Object.keys(studyErrors).length ? [{ value: 'unavailable', label: '状态无法读取' }] : [])]} />

        {listLoaded && searchParams.has('archive') && !archives.some(item => item.id === searchParams.get('archive')) && <Alert type="warning" message="指定归档不存在或已删除，请刷新列表或选择其他版本。" />}

        {error && (
          <Alert
            type="error"
            showIcon
            message="归档列表加载失败"
            description={error}
            action={<Button size="small" onClick={() => void loadArchives()}>重试</Button>}
          />
        )}

        <ArchiveBatchBar
          selectedRowKeys={selectedRowKeys}
          selectedArchives={selectedArchives}
          onClearSelection={() => setSelectedRowKeys([])}
          onDeleteBatch={(targets) => deleteArchives(targets)}
        />

        <Card className="data-panel desktop-data-table archive-table-card" styles={{ body: { padding: 0 } }}>
          <Table<ArchiveEntry>
            className="archive-table"
            columns={columns}
            dataSource={displayArchives}
            rowKey="id"
            loading={loading}
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            pagination={{
              defaultPageSize: 25,
              pageSizeOptions: [10, 25, 50, 100],
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
            locale={{
              emptyText: (
                <Empty description="暂无服务器归档">
                  <Button type="primary" onClick={() => navigate('/kernels')}>前往 Kernel 广场</Button>
                </Empty>
              ),
            }}
            tableLayout="fixed"
          />
        </Card>

        <MobileArchiveCardList
          archives={mobileArchives}
          studies={studies}
          studyErrors={studyErrors}
          allDisplayArchives={displayArchives}
          loading={loading}
          selectedRowKeys={selectedRowKeys}
          setSelectedRowKeys={setSelectedRowKeys}
          mobilePage={mobilePage}
          pageSize={MOBILE_PAGE_SIZE}
          setMobilePage={setMobilePage}
          onNavigateToKernels={() => navigate('/kernels')}
          onShowDetail={(rec) => void showDetail(rec)}
          onDownloadSource={(rec) => void downloadSource(rec)}
          onDeleteArchives={(recs) => deleteArchives(recs)}
        />
      </div>

      <ArchiveDetailModal
        open={detailOpen}
        onClose={closeDetail}
        archives={archives}
        onStudySaved={(id, study) => setStudies(current => ({ ...current, [id]: study }))}
        archive={detailArchive}
        metadata={detailMetadata}
        files={detailFiles}
        loading={detailLoading}
        error={detailError}
        onDownloadSource={(rec) => void downloadSource(rec)}
      />
    </div>
  );
};

export default ArchiveManager;
