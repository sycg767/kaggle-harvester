import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Input,
  Modal,
  Pagination,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
  type TableColumnsType,
} from 'antd';
import {
  DeleteOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  ExportOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api, type ArchiveEntry, type ArchiveFile } from '../api';
import { dispatchArchivesChanged } from '../events';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../kaggleUrls';
import DialogTitle from './DialogTitle';

const { Text } = Typography;
const MOBILE_PAGE_SIZE = 10;

interface ArchiveMetadata {
  metadata?: Record<string, unknown>;
  input_sources?: {
    dataset_sources?: string[];
    kernel_sources?: string[];
    competition_sources?: string[];
  };
}

const DetailField: React.FC<{
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ label, children, wide = false }) => (
  <div className={`archive-detail-field${wide ? ' is-wide' : ''}`}>
    <span className="archive-detail-label">{label}</span>
    <div className="archive-detail-value">{children}</div>
  </div>
);

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

const formatScore = (value?: number) => (
  value === undefined || value === null ? '—' : value.toFixed(4)
);

const normalizeEnumLabel = (value: unknown, kind: 'language' | 'kernel') => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) return '未记录';
  const languageLabels: Record<string, string> = {
    LANGUAGE_PYTHON: 'Python',
    PYTHON: 'Python',
    LANGUAGE_R: 'R',
    R: 'R',
    LANGUAGE_JULIA: 'Julia',
    JULIA: 'Julia',
  };
  const kernelLabels: Record<string, string> = {
    NOTEBOOK: 'Notebook',
    KERNEL_TYPE_NOTEBOOK: 'Notebook',
    SCRIPT: 'Script',
    KERNEL_TYPE_SCRIPT: 'Script',
    BATCH: '批处理',
    INTERACTIVE: '交互式',
  };
  const readable = normalized
    .replace(/^LANGUAGE_/, '')
    .replace(/^KERNEL_TYPE_/, '')
    .toLowerCase()
    .replace(/(^|_)([a-z])/g, (_, prefix, letter) => `${prefix ? ' ' : ''}${letter.toUpperCase()}`);
  return (kind === 'language' ? languageLabels : kernelLabels)[normalized] || readable;
};

const sourceLink = (kind: 'dataset' | 'kernel' | 'competition', source: string) => {
  const normalized = source
    .replace(/^datasets\//, '')
    .replace(/^kernels\//, '')
    .replace(/^code\//, '')
    .replace(/^competitions\//, '');
  if (kind === 'dataset') return `https://www.kaggle.com/datasets/${normalized}`;
  if (kind === 'kernel') return `https://www.kaggle.com/code/${normalized}`;
  return `https://www.kaggle.com/competitions/${normalized}`;
};

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const ArchiveManager: React.FC = () => {
  const navigate = useNavigate();
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [competitionFilter, setCompetitionFilter] = useState('all');
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
      if (!query) return true;
      return [archive.ref, archive.title, archive.author, archive.path, archive.competition || '']
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [archives, competitionFilter, searchText]);

  useEffect(() => {
    setMobilePage(1);
  }, [archives, competitionFilter, searchText]);

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
    } catch (err) {
      message.error(err instanceof Error ? err.message : '无法打开归档目录。');
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

  const exportCsv = () => {
    const headers = ['ref', 'title', 'author', 'competition', 'version', 'public_score', 'archived_at', 'file_count', 'size_bytes', 'path'];
    const rows = displayArchives.map((archive) => [
      archive.ref,
      archive.title,
      archive.author,
      archive.competition,
      archive.version_number,
      archive.public_score,
      archive.archived_at,
      archive.file_count,
      archive.size_bytes,
      archive.path,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kaggle-harvester-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const columns: TableColumnsType<ArchiveEntry> = [
    {
      title: 'Kernel',
      key: 'kernel',
      width: 235,
      render: (_, record) => (
        <div className="kernel-identity">
          <a
            className="kernel-title"
            href={kaggleKernelUrl(record.ref)}
            target="_blank"
            rel="noreferrer"
          >
            {record.title || record.ref}
          </a>
          <span className="kernel-ref">{record.ref}</span>
        </div>
      ),
      sorter: (a, b) => (a.title || a.ref).localeCompare(b.title || b.ref),
    },
    {
      title: '作者',
      dataIndex: 'author',
      width: 100,
      ellipsis: true,
      render: (author: string, record: ArchiveEntry) => {
        const username = kaggleOwnerFromRef(record.ref) || author;
        return (
          <a
            href={kaggleAuthorUrl(username)}
            target="_blank"
            rel="noreferrer"
            aria-label={`打开 @${username} 的 Kaggle 主页`}
          >
            @{username}
          </a>
        );
      },
    },
    {
      title: '竞赛',
      dataIndex: 'competition',
      width: 125,
      ellipsis: true,
      render: (value?: string) => value || '未登记',
    },
    {
      title: '版本',
      dataIndex: 'version_number',
      width: 64,
      render: (value: number) => <Tag color="blue">v{value}</Tag>,
      sorter: (a, b) => a.version_number - b.version_number,
    },
    {
      title: '公开分数',
      dataIndex: 'public_score',
      width: 86,
      render: (value?: number) => value === undefined || value === null ? <Text type="secondary">—</Text> : <span className="score-value">{formatScore(value)}</span>,
      sorter: (a, b) => (a.public_score ?? Number.POSITIVE_INFINITY) - (b.public_score ?? Number.POSITIVE_INFINITY),
    },
    {
      title: '文件',
      key: 'files',
      width: 80,
      render: (_, record) => (
        <div>
          <span>{record.file_count || 0} 个</span>
          <span className="kernel-ref">{formatBytes(record.size_bytes)}</span>
        </div>
      ),
      sorter: (a, b) => a.size_bytes - b.size_bytes,
    },
    {
      title: '归档时间',
      dataIndex: 'archived_at',
      width: 130,
      render: formatDate,
      defaultSortOrder: 'descend',
      sorter: (a, b) => new Date(a.archived_at).getTime() - new Date(b.archived_at).getTime(),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_, record) => (
        <div className="table-actions">
          <Tooltip title="查看详情">
            <Button icon={<EyeOutlined />} aria-label={`查看 ${record.ref}`} onClick={() => showDetail(record)} />
          </Tooltip>
          <Tooltip title="打开目录">
            <Button icon={<FolderOpenOutlined />} aria-label={`打开 ${record.ref} 的目录`} onClick={() => openFolder(record)} />
          </Tooltip>
          <Tooltip title="下载源文件">
            <Button icon={<DownloadOutlined />} aria-label={`下载 ${record.ref}`} onClick={() => downloadSource(record)} />
          </Tooltip>
          <Tooltip title="删除归档">
            <Button danger icon={<DeleteOutlined />} aria-label={`删除 ${record.ref}`} onClick={() => deleteArchives([record])} />
          </Tooltip>
        </div>
      ),
    },
  ];

  const metadata = detailMetadata?.metadata;
  const inputs = detailMetadata?.input_sources;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="page-title-wrap">
          <h1 className="page-title">本地归档</h1>
          <span className="page-subtitle">{archives.length} 个版本 · {formatBytes(totalSize)}</span>
        </div>
        <div className="page-actions">
          <Button icon={<ExportOutlined />} aria-label="导出清单" disabled={!displayArchives.length} onClick={exportCsv}>导出清单</Button>
          <Button icon={<ReloadOutlined />} aria-label="刷新归档" loading={loading} onClick={loadArchives}>刷新</Button>
        </div>
      </header>

      <div className="page-content">

      <div className="metric-grid archive-metrics">
        <Card size="small" className="metric-card"><Statistic title="归档版本" value={archives.length} prefix={<DatabaseOutlined />} /></Card>
        <Card size="small" className="metric-card"><Statistic title="唯一 Kernel" value={uniqueKernels} /></Card>
        <Card size="small" className="metric-card"><Statistic title="作者" value={uniqueAuthors} prefix={<UserOutlined />} /></Card>
        <Card size="small" className="metric-card"><Statistic title="本地占用" value={formatBytes(totalSize)} prefix={<FolderOpenOutlined />} /></Card>
      </div>

      <Card size="small" className="data-toolbar">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={12} lg={10}>
            <Input aria-label="搜索本地归档" allowClear value={searchText} onChange={(event) => setSearchText(event.target.value)} prefix={<SearchOutlined />} placeholder="筛选标题、作者、ref 或路径" />
          </Col>
          <Col xs={24} md={7} lg={6}>
            <Select aria-label="按竞赛筛选归档" value={competitionFilter} onChange={setCompetitionFilter} style={{ width: '100%' }} options={[
              { value: 'all', label: '全部竞赛' },
              ...competitions.map((value) => ({ value, label: value })),
            ]} />
          </Col>
          <Col xs={24} md={5} lg={8} style={{ textAlign: 'right' }}>
            <Text type="secondary">当前显示 {displayArchives.length} 条</Text>
          </Col>
        </Row>
      </Card>

      {error && (
        <Alert
          type="error"
          showIcon
          message="归档列表加载失败"
          description={error}
          action={<Button size="small" onClick={loadArchives}>重试</Button>}
        />
      )}

      {!!selectedRowKeys.length && (
        <Alert
          type="info"
          showIcon
          message={`已选择 ${selectedRowKeys.length} 个归档版本`}
          action={<Space><Button size="small" onClick={() => setSelectedRowKeys([])}>取消</Button><Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteArchives(selectedArchives)}>批量删除</Button></Space>}
        />
      )}

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

      <div className="mobile-data-list" aria-label="本地归档列表">
        {!displayArchives.length && !loading && (
          <Empty description="暂无本地归档">
            <Button type="primary" onClick={() => navigate('/kernels')}>前往 Kernel 广场</Button>
          </Empty>
        )}
        {mobileArchives.map((archive) => {
          const owner = kaggleOwnerFromRef(archive.ref) || archive.author;
          const selected = selectedRowKeys.includes(archive.id);
          return (
            <article className="mobile-data-card" key={archive.id}>
              <div className="mobile-data-card-head">
                <Checkbox
                  checked={selected}
                  aria-label={`选择 ${archive.ref} v${archive.version_number}`}
                  onChange={(event) => setSelectedRowKeys((current) => (
                    event.target.checked
                      ? [...current, archive.id]
                      : current.filter((value) => value !== archive.id)
                  ))}
                />
                <div className="mobile-data-card-title">
                  <a className="kernel-title" href={kaggleKernelUrl(archive.ref)} target="_blank" rel="noreferrer">
                    {archive.title || archive.ref}
                  </a>
                  <span className="kernel-ref">{archive.ref}</span>
                </div>
                <Tag color="blue">v{archive.version_number}</Tag>
              </div>
              <div className="mobile-data-card-meta">
                <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer">
                  <UserOutlined /> @{owner}
                </a>
                <span>{archive.competition || '未登记竞赛'}</span>
                <span className="score-value">
                  分数 {formatScore(archive.public_score)}
                </span>
                <span>{archive.file_count || 0} 个文件 · {formatBytes(archive.size_bytes)}</span>
                <span>{formatDate(archive.archived_at)}</span>
              </div>
              <div className="mobile-data-card-actions">
                <Button icon={<EyeOutlined />} onClick={() => showDetail(archive)}>详情</Button>
                <Tooltip title="打开归档目录">
                  <Button icon={<FolderOpenOutlined />} aria-label="打开归档目录" onClick={() => openFolder(archive)} />
                </Tooltip>
                <Tooltip title="下载源文件">
                  <Button icon={<DownloadOutlined />} aria-label="下载源文件" onClick={() => downloadSource(archive)} />
                </Tooltip>
                <Tooltip title="删除归档">
                  <Button danger icon={<DeleteOutlined />} aria-label="删除归档" onClick={() => deleteArchives([archive])} />
                </Tooltip>
              </div>
            </article>
          );
        })}
        {displayArchives.length > MOBILE_PAGE_SIZE && (
          <div className="mobile-list-footer">
            <Text type="secondary">总计：{displayArchives.length}</Text>
            <Pagination
              simple
              size="small"
              current={mobilePage}
              pageSize={MOBILE_PAGE_SIZE}
              total={displayArchives.length}
              showSizeChanger={false}
              onChange={setMobilePage}
            />
          </div>
        )}
      </div>
      </div>

      <Modal
        title={(
          <DialogTitle onClose={() => setDetailOpen(false)}>
            {detailArchive ? `${detailArchive.ref} · v${detailArchive.version_number}` : '归档详情'}
          </DialogTitle>
        )}
        open={detailOpen}
        closable={false}
        width={880}
        onCancel={() => setDetailOpen(false)}
        footer={
          <Space>
            {detailArchive && (
              <>
                <Button icon={<FolderOpenOutlined />} onClick={() => openFolder(detailArchive)}>打开目录</Button>
                <Button icon={<DownloadOutlined />} onClick={() => downloadSource(detailArchive)}>下载源文件</Button>
              </>
            )}
            <Button type="primary" onClick={() => setDetailOpen(false)}>关闭</Button>
          </Space>
        }
      >
        {detailLoading ? (
          <div style={{ display: 'grid', minHeight: 240, placeItems: 'center' }}><Spin /></div>
        ) : detailError ? (
          <Alert type="error" showIcon message="详情加载失败" description={detailError} />
        ) : detailArchive ? (
          <>
            <div className="archive-detail-grid" aria-label="归档基础信息">
              <DetailField label="Kernel">
                <a href={kaggleKernelUrl(detailArchive.ref)} target="_blank" rel="noreferrer">
                  {detailArchive.ref}
                </a>
              </DetailField>
              <DetailField label="作者">
                <a
                  href={kaggleAuthorUrl(
                    kaggleOwnerFromRef(detailArchive.ref) || detailArchive.author,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{kaggleOwnerFromRef(detailArchive.ref) || detailArchive.author}
                </a>
              </DetailField>
              <DetailField label="竞赛">{detailArchive.competition || '未登记'}</DetailField>
              <DetailField label="公开分数"><span className="score-value">{formatScore(detailArchive.public_score)}</span></DetailField>
              <DetailField label="归档时间">{formatDate(detailArchive.archived_at)}</DetailField>
              <DetailField label="包含输出">{detailArchive.include_outputs ? <Tag color="success">是</Tag> : <Tag>否</Tag>}</DetailField>
              <DetailField label="保存路径" wide>
                <Text copyable className="archive-path-value">{detailArchive.path}</Text>
              </DetailField>
            </div>

            {(inputs?.dataset_sources?.length || inputs?.kernel_sources?.length || inputs?.competition_sources?.length) ? (
              <section className="detail-section">
                <h3 className="detail-section-title">输入依赖</h3>
                <div className="source-list">
                  {inputs.dataset_sources?.map((source) => <a key={`dataset-${source}`} href={sourceLink('dataset', source)} target="_blank" rel="noreferrer"><Tag>Dataset · {source}</Tag></a>)}
                  {inputs.kernel_sources?.map((source) => <a key={`kernel-${source}`} href={sourceLink('kernel', source)} target="_blank" rel="noreferrer"><Tag color="blue">Kernel · {source}</Tag></a>)}
                  {inputs.competition_sources?.map((source) => <a key={`competition-${source}`} href={sourceLink('competition', source)} target="_blank" rel="noreferrer"><Tag color="green">Competition · {source}</Tag></a>)}
                </div>
              </section>
            ) : null}

            {metadata && (
              <section className="detail-section">
                <h3 className="detail-section-title">运行元数据</h3>
                <div className="archive-detail-grid is-compact">
                  <DetailField label="语言">{normalizeEnumLabel(metadata.language, 'language')}</DetailField>
                  <DetailField label="类型">{normalizeEnumLabel(metadata.kernelType, 'kernel')}</DetailField>
                  <DetailField label="GPU">{metadata.enableGpu === true ? <Tag color="success">已启用</Tag> : metadata.enableGpu === false ? <Tag>未启用</Tag> : <Tag>未记录</Tag>}</DetailField>
                  <DetailField label="Internet">{metadata.enableInternet === true ? <Tag color="success">已启用</Tag> : metadata.enableInternet === false ? <Tag>未启用</Tag> : <Tag>未记录</Tag>}</DetailField>
                </div>
              </section>
            )}

            <section className="detail-section">
              <h3 className="detail-section-title">归档文件</h3>
              <Table<ArchiveFile>
                dataSource={detailFiles}
                rowKey="name"
                size="small"
                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                columns={[
                  { title: '文件', dataIndex: 'name', ellipsis: true, render: (value) => <span className="mono-text">{value}</span> },
                  { title: '类型', dataIndex: 'type', width: 100, responsive: ['sm'], render: (value) => <Tag>{value}</Tag> },
                  { title: '大小', dataIndex: 'size_bytes', width: 90, render: formatBytes },
                ]}
              />
            </section>
          </>
        ) : null}
      </Modal>
    </div>
  );
};

export default ArchiveManager;
