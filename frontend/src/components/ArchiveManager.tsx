import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Modal,
} from 'antd';
import {
  Table,
} from 'antd';
import {
  DeleteOutlined,
  ExportOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { api, type ArchiveEntry, type ArchiveFile } from '../api';
import { dispatchArchivesChanged } from '../events';
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
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(false);
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
      setArchives(await api.listArchives());
      dispatchArchivesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '归档列表加载失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadArchives();
  }, []);

  const competitions = useMemo(
    () => [...new Set(archives.map((archive) => archive.competition).filter(Boolean) as string[])].sort(),
    [archives],
  );

  const displayArchives = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return archives.filter((archive) => {
      if (competitionFilter !== 'all' && archive.competition !== competitionFilter) return false;
      if (scoredOnly && (archive.public_score === undefined || archive.public_score === null)) return false;
      if (!query) return true;
      return [archive.ref, archive.title, archive.author, archive.path, archive.competition || '']
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [archives, competitionFilter, scoredOnly, searchText]);

  useEffect(() => {
    setMobilePage(1);
  }, [archives, competitionFilter, scoredOnly, searchText]);

  const mobileArchives = useMemo(
    () => displayArchives.slice((mobilePage - 1) * MOBILE_PAGE_SIZE, mobilePage * MOBILE_PAGE_SIZE),
    [displayArchives, mobilePage],
  );

  const selectedArchives = useMemo(() => {
    const selected = new Set(selectedRowKeys.map(String));
    return archives.filter((archive) => selected.has(archive.id));
  }, [archives, selectedRowKeys]);

  const uniqueKernels = new Set(archives.map((archive) => archive.ref)).size;
  const uniqueAuthors = new Set(archives.map((archive) => archive.author)).size;
  const totalSize = archives.reduce((sum, archive) => sum + (archive.size_bytes || 0), 0);

  const showDetail = async (archive: ArchiveEntry) => {
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
      setDetailMetadata(metadata as ArchiveMetadata);
      setDetailFiles(files);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '归档详情加载失败。');
    } finally {
      setDetailLoading(false);
    }
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

  const openFolder = async (archive: ArchiveEntry) => {
    try {
      await api.openArchiveFolder(archive.id);
      message.success('已请求在文件资源管理器中打开目录');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '无法打开归档目录。');
    }
  };

  const openVsCode = async (archive: ArchiveEntry) => {
    try {
      await api.openArchiveInCode(archive.id);
      message.success('已请求在 VS Code 中打开归档文件');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '无法在 VS Code 中打开，请确认已安装 VS Code。');
    }
  };

  const deleteArchives = (targets: ArchiveEntry[]) => {
    if (!targets.length) return;
    Modal.confirm({
      title: targets.length === 1 ? '删除这个归档版本？' : `删除 ${targets.length} 个归档版本？`,
      content: '对应本地文件会一并删除，此操作无法撤销。',
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
        await loadArchives();
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
      createArchiveTableColumns({
        onOpenVsCode: (rec) => void openVsCode(rec),
        onShowDetail: (rec) => void showDetail(rec),
        onOpenFolder: (rec) => void openFolder(rec),
        onDownloadSource: (rec) => void downloadSource(rec),
        onDeleteArchives: (records) => deleteArchives(records),
      }),
    [],
  );

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="page-title-wrap">
          <h1 className="page-title">本地归档</h1>
          <span className="page-subtitle">{archives.length} 个版本 · {formatBytes(totalSize)}</span>
        </div>
        <div className="page-actions">
          <Button
            icon={<ExportOutlined />}
            aria-label="导出清单"
            disabled={!displayArchives.length}
            onClick={() => exportArchiveListCsv(displayArchives)}
          >
            导出清单
          </Button>
          <Button
            icon={<ReloadOutlined />}
            aria-label="刷新归档"
            loading={loading}
            onClick={() => void loadArchives()}
          >
            刷新
          </Button>
        </div>
      </header>

      <div className="page-content">
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

        <Card className="data-panel desktop-data-table" styles={{ body: { padding: 0 } }}>
          <Table<ArchiveEntry>
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
                <Empty description="暂无本地归档">
                  <Button type="primary" onClick={() => navigate('/kernels')}>前往发现页</Button>
                </Empty>
              ),
            }}
            tableLayout="fixed"
          />
        </Card>

        <MobileArchiveCardList
          archives={mobileArchives}
          allDisplayArchives={displayArchives}
          loading={loading}
          selectedRowKeys={selectedRowKeys}
          setSelectedRowKeys={setSelectedRowKeys}
          mobilePage={mobilePage}
          pageSize={MOBILE_PAGE_SIZE}
          setMobilePage={setMobilePage}
          onNavigateToKernels={() => navigate('/kernels')}
          onShowDetail={(rec) => void showDetail(rec)}
          onOpenVsCode={(rec) => void openVsCode(rec)}
          onOpenFolder={(rec) => void openFolder(rec)}
          onDownloadSource={(rec) => void downloadSource(rec)}
          onDeleteArchives={(recs) => deleteArchives(recs)}
        />
      </div>

      <ArchiveDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        archive={detailArchive}
        metadata={detailMetadata}
        files={detailFiles}
        loading={detailLoading}
        error={detailError}
        onOpenVsCode={(rec) => void openVsCode(rec)}
        onOpenFolder={(rec) => void openFolder(rec)}
        onDownloadSource={(rec) => void downloadSource(rec)}
      />
    </div>
  );
};

export default ArchiveManager;
