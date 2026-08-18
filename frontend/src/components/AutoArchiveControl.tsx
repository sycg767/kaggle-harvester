import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Gauge } from 'lucide-react';
import {
  api,
  type AutoArchiveCheckedItem,
  type AutoArchiveConfig,
  type AutoArchiveRunDetail,
  type AutoArchiveRunLog,
  type AutoArchiveSnapshot,
  type EnteredCompetition,
} from '../api';
import { buildEnteredCompetitionOptions, competitionDisplayName } from '../competitionOptions';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../kaggleUrls';
import DialogTitle from './DialogTitle';

const { Text } = Typography;

interface AutoArchiveControlProps {
  currentCompetition: string;
  onArchiveComplete?: () => void;
}

interface SummaryItemProps {
  label: string;
  children: React.ReactNode;
  tabular?: boolean;
}

const SummaryItem: React.FC<SummaryItemProps> = ({ label, children, tabular = false }) => (
  <div className="auto-archive-summary-item">
    <span className="auto-archive-summary-label">{label}</span>
    <div className={`auto-archive-summary-value${tabular ? ' is-tabular' : ''}`}>{children}</div>
  </div>
);

const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

const formatDuration = (seconds: number) => {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
};

const renderRunOutcome = (log: AutoArchiveRunLog) => {
  if (log.outcome === 'success') {
    return <Tag color="success" icon={<CheckCircleOutlined />}>成功</Tag>;
  }
  if (log.outcome === 'partial') {
    return (
      <Tooltip title={log.error || '部分 Kernel 处理失败'}>
        <Tag color="warning" icon={<ExclamationCircleOutlined />}>部分失败</Tag>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={log.error || '检查失败'}>
      <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>
    </Tooltip>
  );
};

const renderCheckedAction = (item: AutoArchiveCheckedItem) => {
  if (item.action === 'archived') {
    return <Tag color="success" icon={<CheckCircleOutlined />}>已归档</Tag>;
  }
  if (item.action === 'skipped') return <Tag color="blue">已处理</Tag>;
  if (item.action === 'failed') {
    return (
      <Tooltip title={item.error || '归档失败'}>
        <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>
      </Tooltip>
    );
  }
  return <Tag>未命中</Tag>;
};

const detailColumns: TableColumnsType<AutoArchiveCheckedItem> = [
  {
    title: '竞赛',
    dataIndex: 'competition',
    width: 150,
    ellipsis: true,
    render: (value?: string) => value || '—',
  },
  {
    title: '分数',
    dataIndex: 'public_score',
    width: 92,
    sorter: (a, b) => (a.public_score ?? Number.POSITIVE_INFINITY) - (b.public_score ?? Number.POSITIVE_INFINITY),
    render: (value?: number) => value === undefined || value === null ? '—' : <Text strong>{value.toFixed(4)}</Text>,
  },
  {
    title: 'Kernel',
    key: 'kernel',
    width: 300,
    render: (_, item) => (
      <div style={{ minWidth: 0 }}>
        <a href={kaggleKernelUrl(item.ref)} target="_blank" rel="noreferrer" className="kernel-title">
          {item.title || item.ref}
        </a>
        <Text type="secondary" className="kernel-ref">{item.ref}</Text>
      </div>
    ),
  },
  {
    title: '作者',
    dataIndex: 'author',
    width: 135,
    ellipsis: true,
    render: (value: string, item) => {
      const owner = kaggleOwnerFromRef(item.ref);
      return <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer">{value || owner}</a>;
    },
  },
  {
    title: '最后运行',
    dataIndex: 'last_run_time',
    width: 170,
    render: formatDate,
  },
  {
    title: '处理结果',
    key: 'action',
    width: 110,
    render: (_, item) => renderCheckedAction(item),
  },
  {
    title: '版本',
    dataIndex: 'version_number',
    width: 75,
    render: (value?: number) => value ? `v${value}` : '—',
  },
];

const AutoArchiveControl: React.FC<AutoArchiveControlProps> = ({
  currentCompetition,
  onArchiveComplete,
}) => {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<AutoArchiveConfig>();
  const [snapshot, setSnapshot] = useState<AutoArchiveSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<AutoArchiveRunLog | null>(null);
  const [runDetail, setRunDetail] = useState<AutoArchiveRunDetail | null>(null);
  const [detailSearch, setDetailSearch] = useState('');
  const [detailAction, setDetailAction] = useState('all');
  const [narrowViewport, setNarrowViewport] = useState(
    () => window.matchMedia('(max-width: 768px)').matches,
  );
  const [enteredCompetitions, setEnteredCompetitions] = useState<EnteredCompetition[]>([]);
  const [enteredLoading, setEnteredLoading] = useState(false);
  const [enteredError, setEnteredError] = useState<string | null>(null);
  const latestLogIdRef = useRef<string | null>(null);
  const onArchiveCompleteRef = useRef(onArchiveComplete);

  useEffect(() => {
    onArchiveCompleteRef.current = onArchiveComplete;
  }, [onArchiveComplete]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 768px)');
    const update = () => setNarrowViewport(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const loadStatus = useCallback(async (fillForm = false) => {
    try {
      const data = await api.getAutoArchive();
      setSnapshot(data);
      setLoadError(null);
      const latestLog = data.logs[0];
      if (latestLogIdRef.current === null) {
        latestLogIdRef.current = latestLog?.id || '';
      } else if (latestLog && latestLog.id !== latestLogIdRef.current) {
        latestLogIdRef.current = latestLog.id;
        if (latestLog.archived_count > 0) onArchiveCompleteRef.current?.();
      }
      if (fillForm) {
        const competitions = data.config.enabled
          ? data.config.competitions
          : Array.from(new Set([
            ...(data.config.competitions || []),
            currentCompetition,
          ].filter(Boolean)));
        form.setFieldsValue({
          ...data.config,
          competitions,
          score_thresholds: data.config.score_thresholds || {},
        });
      }
      return data;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '自动归档状态读取失败。');
      return null;
    }
  }, [currentCompetition, form]);

  const loadEnteredCompetitions = useCallback(async (refresh = false) => {
    setEnteredLoading(true);
    setEnteredError(null);
    try {
      const items = await getEnteredCompetitions({ refresh });
      setEnteredCompetitions(items);
    } catch (error) {
      setEnteredError(error instanceof Error ? error.message : '已参加竞赛列表读取失败。');
    } finally {
      setEnteredLoading(false);
    }
  }, []);

  const competitionSelectOptions = useMemo(
    () => buildEnteredCompetitionOptions(enteredCompetitions, [
      ...(snapshot?.config.competitions || []),
      currentCompetition,
    ]),
    [currentCompetition, enteredCompetitions, snapshot?.config.competitions],
  );

  const competitionTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of enteredCompetitions) {
      map.set(item.id, competitionDisplayName(item));
    }
    return map;
  }, [enteredCompetitions]);

  useEffect(() => {
    void loadStatus(false);
    const timer = window.setInterval(
      () => void loadStatus(false),
      open ? 5_000 : 30_000,
    );
    return () => window.clearInterval(timer);
  }, [loadStatus, open]);

  const showSettings = async () => {
    setOpen(true);
    setLoading(true);
    await Promise.all([loadStatus(true), loadEnteredCompetitions(false)]);
    setLoading(false);
  };

  const saveConfig = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const data = await api.updateAutoArchive(values);
      setSnapshot(data);
      form.setFieldsValue(data.config);
      message.success(values.enabled ? '自动归档已启用' : '自动归档配置已保存');
      return data;
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    let values: AutoArchiveConfig;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setRunning(true);
    try {
      await api.updateAutoArchive(values);
      const data = await api.runAutoArchive();
      setSnapshot(data);
      latestLogIdRef.current = data.logs[0]?.id || latestLogIdRef.current;
      form.setFieldsValue(data.config);
      if (data.status.archived_count > 0) onArchiveComplete?.();
      message.success(
        `检查完成：新增 ${data.status.archived_count}，跳过 ${data.status.skipped_count}`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '立即检查失败。');
      await loadStatus(false);
    } finally {
      setRunning(false);
    }
  };

  const showRunDetail = async (log: AutoArchiveRunLog) => {
    setSelectedLog(log);
    setRunDetail(null);
    setDetailError(null);
    setDetailSearch('');
    setDetailAction('all');
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const detail = await api.getAutoArchiveLog(log.id);
      setRunDetail(detail);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '运行明细读取失败。');
    } finally {
      setDetailLoading(false);
    }
  };

  const detailItems = useMemo(() => {
    const query = detailSearch.trim().toLowerCase();
    return (runDetail?.items || []).filter((item) => {
      if (detailAction !== 'all' && item.action !== detailAction) return false;
      if (!query) return true;
      return [item.ref, item.title, item.author]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [detailAction, detailSearch, runDetail?.items]);

  const status = snapshot?.status;
  const enabled = snapshot?.config.enabled ?? false;
  const directionLabel = status?.effective_score_direction === 'maximize'
    ? '高于阈值时归档'
    : status?.effective_score_direction === 'minimize'
      ? '低于阈值时归档'
      : '首次检查时自动识别分数方向';

  return (
    <>
      <Space size={4} className="auto-archive-trigger">
        {enabled && <Tag color="success">已启用</Tag>}
        <Button icon={<ClockCircleOutlined />} aria-label="自动归档" onClick={() => void showSettings()}>
          自动归档
        </Button>
      </Space>

      <Modal
        className="newapi-dialog auto-archive-modal"
        title={(
          <DialogTitle disabled={running} onClose={() => !running && setOpen(false)}>
            <Space><ClockCircleOutlined />自动归档设置</Space>
          </DialogTitle>
        )}
        open={open}
        forceRender
        destroyOnHidden={false}
        closable={false}
        width={900}
        confirmLoading={saving}
        styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowX: 'hidden', overflowY: 'auto' } }}
        onCancel={() => !running && setOpen(false)}
        maskClosable={!running}
        footer={[
          <Button key="close" disabled={running} onClick={() => setOpen(false)}>关闭</Button>,
          <Button
            key="run"
            icon={<ReloadOutlined />}
            loading={running}
            disabled={saving}
            onClick={() => void runNow()}
          >
            立即检查
          </Button>,
          <Button
            key="save"
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={running}
            onClick={() => void saveConfig().catch((error) => {
              message.error(error instanceof Error ? error.message : '配置保存失败。');
            })}
          >
            保存配置
          </Button>,
        ]}
      >
        {loadError && (
          <Alert
            type="error"
            showIcon
            message="状态读取失败"
            description={loadError}
            style={{ marginBottom: 16 }}
          />
        )}

        <Alert
          className="auto-archive-note"
          type="info"
          showIcon
          icon={<Gauge size={16} strokeWidth={1.9} />}
          message={`每次检查公开分数榜前 50 条；${directionLabel}。运行时间未变化时复用缓存，新版本出现后才检查历史并归档。通知通道请在「通知中心」配置。`}
          style={{ marginBottom: 16 }}
        />

        <div
          className={`auto-archive-scheduler-status${status?.scheduler_alive ? ' is-online' : ' is-offline'}`}
          role="status"
          aria-live="polite"
        >
          <span className="auto-archive-scheduler-icon" aria-hidden="true">
            {status?.scheduler_alive ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
          </span>
          <div className="auto-archive-scheduler-copy">
            <span className="auto-archive-scheduler-title">本地调度器</span>
            <span className="auto-archive-scheduler-detail">
              {status?.scheduler_alive ? '在线' : '未运行'}
            </span>
          </div>
        </div>

        <Form<AutoArchiveConfig>
          form={form}
          layout="vertical"
          disabled={loading || running}
          initialValues={{
            enabled: false,
            competitions: currentCompetition ? [currentCompetition] : [],
            score_thresholds: {},
            interval_minutes: 30,
            include_outputs: false,
            score_direction: 'auto',
          }}
        >
          <Row gutter={16}>
            <Col xs={24} sm={16}>
              <Form.Item
                name="competitions"
                label="监控竞赛"
                rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一个竞赛' }]}
                extra={
                  enteredError
                    ? `已参加列表读取失败：${enteredError}。仍可选择当前页竞赛或已保存项。`
                    : (
                      <span>
                        已参加竞赛 · 可多选
                        {' · '}
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto' }}
                          loading={enteredLoading}
                          onClick={() => void loadEnteredCompetitions(true)}
                        >
                          刷新
                        </Button>
                      </span>
                    )
                }
              >
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  loading={enteredLoading}
                  optionFilterProp="label"
                  placeholder="选择竞赛"
                  aria-label="自动归档监控竞赛"
                  options={competitionSelectOptions}
                  maxTagCount="responsive"
                  maxTagTextLength={28}
                  listHeight={280}
                  popupMatchSelectWidth={false}
                  styles={{ popup: { root: { minWidth: 320 } } }}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="interval_minutes" label="刷新间隔" rules={[{ required: true }]}>
                <Select aria-label="自动归档刷新间隔" options={[
                  { value: 1, label: '1 分钟' },
                  { value: 2, label: '2 分钟' },
                  { value: 5, label: '5 分钟' },
                  { value: 10, label: '10 分钟' },
                  { value: 30, label: '30 分钟' },
                  { value: 60, label: '1 小时' },
                  { value: 180, label: '3 小时' },
                  { value: 360, label: '6 小时' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.competitions !== next.competitions}>
            {() => {
              const competitions = (form.getFieldValue('competitions') as string[] | undefined) || [];
              if (!competitions.length) return null;
              return (
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    各竞赛分数阈值（启用时必填）
                  </Text>
                  <Row gutter={[16, 12]}>
                    {competitions.map((slug) => (
                      <Col xs={24} sm={12} key={slug}>
                        <Form.Item
                          name={['score_thresholds', slug]}
                          label={competitionTitleById.get(slug) || slug}
                          rules={[{ required: true, message: `请设置阈值` }]}
                          style={{ marginBottom: 4 }}
                          extra={<Text type="secondary" style={{ fontSize: 12 }}>{slug}</Text>}
                        >
                          <InputNumber
                            aria-label={`${slug} 分数阈值`}
                            precision={6}
                            style={{ width: '100%' }}
                            placeholder="例如 7.0"
                          />
                        </Form.Item>
                      </Col>
                    ))}
                  </Row>
                </div>
              );
            }}
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item name="enabled" valuePropName="checked" label="定时任务" style={{ marginBottom: 16 }}>
              <Switch checkedChildren="已启用" unCheckedChildren="已关闭" />
            </Form.Item>
            <Form.Item name="include_outputs" valuePropName="checked" label="归档内容" style={{ marginBottom: 16 }}>
              <Switch checkedChildren="包含输出" unCheckedChildren="仅源码" />
            </Form.Item>
          </Space>
          <Form.Item
            name="score_direction"
            label="分数方向"
            extra="自动识别失败时任务会停止，不会按默认方向归档。多竞赛方向不一致时请拆分配置。"
          >
            <Select options={[
              { value: 'auto', label: '自动识别（仅接受可靠来源）' },
              { value: 'minimize', label: '越低越好' },
              { value: 'maximize', label: '越高越好' },
            ]} />
          </Form.Item>
        </Form>

        <div className="auto-archive-summary-grid" role="group" aria-label="自动归档运行状态">
          <SummaryItem label="任务状态">
            {!status?.scheduler_alive
              ? <Tag color="error">调度器离线</Tag>
              : status?.running
              ? <Tag color="processing">正在检查</Tag>
              : enabled
                ? <Tag color="success">等待下次检查</Tag>
                : <Tag>已关闭</Tag>}
          </SummaryItem>
          <SummaryItem label="监控竞赛" tabular>
            {snapshot?.config.competitions?.length
              ? `${snapshot.config.competitions.length} 个`
              : '—'}
          </SummaryItem>
          <SummaryItem label="最近检查" tabular>{formatDate(status?.last_checked_at)}</SummaryItem>
          <SummaryItem label="下次检查" tabular>{formatDate(status?.next_run_at)}</SummaryItem>
          <SummaryItem label="调度心跳" tabular>{formatDate(status?.scheduler_heartbeat_at)}</SummaryItem>
          <SummaryItem label="服务启动" tabular>{formatDate(status?.service_started_at)}</SummaryItem>
          <SummaryItem label="最近结果">
            {status
              ? `${status.checked_count} 个已检查，${status.matched_count} 个命中`
              : '—'}
          </SummaryItem>
          <SummaryItem label="本地新增" tabular>{status?.archived_count ?? 0}</SummaryItem>
          <SummaryItem label="已存在 / 失败" tabular>
            {status ? `${status.skipped_count} / ${status.failed_count}` : '0 / 0'}
          </SummaryItem>
        </div>

        {status?.last_error && (
          <Alert
            type="error"
            showIcon
            message="最近一次检查有错误"
            description={status.last_error}
            style={{ marginTop: 16 }}
          />
        )}

        <div className="dialog-section-heading">
          <HistoryOutlined />
          <Text strong>运行记录</Text>
          <Text type="secondary" className="dialog-section-hint">弹窗打开时每 5 秒更新</Text>
        </div>
        <List<AutoArchiveRunLog>
          className="auto-archive-log-list"
          size="small"
          dataSource={snapshot?.logs || []}
          pagination={{ pageSize: 5, hideOnSinglePage: true }}
          locale={{ emptyText: <Text type="secondary">定时任务尚未完成过检查</Text> }}
          renderItem={(log) => (
            <List.Item
              className="auto-archive-log-row"
              role="button"
              tabIndex={0}
              aria-label={`查看 ${formatDate(log.finished_at)} 的检查详情`}
              actions={[
                <Tooltip title="查看本次检查的 Kernel 明细" key="detail">
                  <Button
                    type="text"
                    icon={<RightOutlined />}
                    aria-label={`打开 ${formatDate(log.finished_at)} 的检查详情`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void showRunDetail(log);
                    }}
                  />
                </Tooltip>,
              ]}
              onClick={() => void showRunDetail(log)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void showRunDetail(log);
                }
              }}
            >
              <List.Item.Meta
                title={(
                  <Space size={6} wrap>
                    <Text strong>{formatDate(log.finished_at)}</Text>
                    <Tag icon={log.trigger === 'scheduled' ? <ClockCircleOutlined /> : undefined}>
                      {log.trigger === 'scheduled' ? '定时' : '手动'}
                    </Tag>
                    {renderRunOutcome(log)}
                  </Space>
                )}
                description={(
                  <Space size={12} wrap className="auto-archive-log-summary">
                    <span>检查 <Text strong>{log.checked_count}</Text></span>
                    <span>命中 <Text strong>{log.matched_count}</Text></span>
                    <span>新增 <Text type={log.archived_count > 0 ? 'success' : undefined} strong>{log.archived_count}</Text></span>
                    <span>跳过 <Text>{log.skipped_count}</Text></span>
                    {log.failed_count > 0 && <span>失败 <Text type="danger" strong>{log.failed_count}</Text></span>}
                    <Text type="secondary">耗时 {formatDuration(log.duration_seconds)}</Text>
                    {!log.details_available && <Text type="secondary">仅汇总</Text>}
                  </Space>
                )}
              />
            </List.Item>
          )}
        />
      </Modal>

      <Drawer
        className="newapi-detail-drawer"
        title={(
          <DialogTitle onClose={() => setDetailOpen(false)}>
            <Space size={8} wrap>
              <HistoryOutlined />
              <span>检查详情</span>
              <Text type="secondary">{formatDate(selectedLog?.finished_at)}</Text>
            </Space>
          </DialogTitle>
        )}
        closable={false}
        extra={selectedLog ? renderRunOutcome(selectedLog) : null}
        open={detailOpen}
        width={narrowViewport ? '100%' : 980}
        zIndex={1100}
        onClose={() => setDetailOpen(false)}
      >
        {detailLoading ? (
          <div style={{ padding: 64, textAlign: 'center' }}><Spin /></div>
        ) : detailError ? (
          <Alert type="error" showIcon message="运行明细读取失败" description={detailError} />
        ) : runDetail && selectedLog ? (
          <>
            <div className="auto-archive-summary-grid" role="group" aria-label="本次检查汇总">
              <SummaryItem label="触发方式">
                {selectedLog.trigger === 'scheduled' ? '定时检查' : '手动检查'}
              </SummaryItem>
              <SummaryItem label="完成时间" tabular>{formatDate(selectedLog.finished_at)}</SummaryItem>
              <SummaryItem label="耗时" tabular>{formatDuration(selectedLog.duration_seconds)}</SummaryItem>
              <SummaryItem label="检查 / 命中" tabular>
                {selectedLog.checked_count} / {selectedLog.matched_count}
              </SummaryItem>
              <SummaryItem label="新增 / 跳过" tabular>
                {selectedLog.archived_count} / {selectedLog.skipped_count}
              </SummaryItem>
              <SummaryItem label="失败" tabular>{selectedLog.failed_count}</SummaryItem>
            </div>

            {!runDetail.log.details_available && (
              <Alert
                type="info"
                showIcon
                message="该记录创建于详细日志启用前，仅保留汇总数据。"
                style={{ marginTop: 16 }}
              />
            )}

            {runDetail.log.details_available && (
              <>
                <Row gutter={[12, 12]} style={{ marginTop: 16, marginBottom: 12 }}>
                  <Col xs={24} sm={16}>
                    <Input
                      aria-label="筛选检查明细"
                      allowClear
                      prefix={<SearchOutlined />}
                      value={detailSearch}
                      placeholder="筛选 Kernel、作者或 ref"
                      onChange={(event) => setDetailSearch(event.target.value)}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Select
                      aria-label="检查明细处理结果筛选"
                      value={detailAction}
                      style={{ width: '100%' }}
                      onChange={setDetailAction}
                      options={[
                        { value: 'all', label: '全部处理结果' },
                        { value: 'not_matched', label: '未命中阈值' },
                        { value: 'archived', label: '新增归档' },
                        { value: 'skipped', label: '已处理 / 跳过' },
                        { value: 'failed', label: '处理失败' },
                      ]}
                    />
                  </Col>
                </Row>
                <div className="desktop-data-table">
                  <Table<AutoArchiveCheckedItem>
                    size="small"
                    rowKey="ref"
                    columns={detailColumns}
                    dataSource={detailItems}
                    pagination={{
                      defaultPageSize: 10,
                      pageSizeOptions: [10, 25, 50],
                      showSizeChanger: true,
                      showTotal: (total) => `显示 ${total} / ${runDetail.items.length} 个 Kernel`,
                    }}
                    scroll={{ x: 900 }}
                  />
                </div>
                <div className="mobile-data-list auto-archive-detail-list">
                  {!detailItems.length && <Empty description="没有符合条件的 Kernel" />}
                  {detailItems.map((item) => {
                    const owner = kaggleOwnerFromRef(item.ref);
                    return (
                      <article className="mobile-data-card" key={item.ref}>
                        <div className="mobile-data-card-head">
                          <div className="mobile-data-card-title">
                            <a className="kernel-title" href={kaggleKernelUrl(item.ref)} target="_blank" rel="noreferrer">
                              {item.title || item.ref}
                            </a>
                            <span className="kernel-ref">{item.ref}</span>
                          </div>
                          <span className="score-value">
                            {item.public_score === undefined || item.public_score === null ? '—' : item.public_score.toFixed(4)}
                          </span>
                        </div>
                        <div className="mobile-data-card-meta">
                          <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer">@{item.author || owner}</a>
                          <span>{formatDate(item.last_run_time)}</span>
                          {item.version_number && <span>v{item.version_number}</span>}
                          {renderCheckedAction(item)}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : null}
      </Drawer>
    </>
  );
};

export default AutoArchiveControl;
