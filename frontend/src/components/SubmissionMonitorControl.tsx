import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
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
  message,
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
import { Activity } from 'lucide-react';
import {
  api,
  type EnteredCompetition,
  type SubmissionMonitorConfig,
  type SubmissionMonitorItem,
  type SubmissionMonitorRunDetail,
  type SubmissionMonitorRunLog,
  type SubmissionMonitorSnapshot,
  type SubmissionScoreEvent,
} from '../api';
import { buildEnteredCompetitionOptions } from '../competitionOptions';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import DialogTitle from './DialogTitle';

const { Text } = Typography;

interface SubmissionMonitorControlProps {
  currentCompetition: string;
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
  // 无时区标记时按 UTC 解析（Kaggle/后端常见），固定显示为北京时间。
  let normalized = value.trim();
  if (
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(normalized)
    && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
  ) {
    normalized = `${normalized.replace(' ', 'T')}Z`;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDuration = (seconds: number) => {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
};

const formatScore = (item: SubmissionMonitorItem | SubmissionScoreEvent) => {
  if (item.public_score_display) return item.public_score_display;
  if (typeof item.public_score === 'number') return item.public_score.toFixed(4);
  return '—';
};

const renderRunOutcome = (log: SubmissionMonitorRunLog) => {
  if (log.outcome === 'success') {
    return <Tag color="success" icon={<CheckCircleOutlined />}>成功</Tag>;
  }
  if (log.outcome === 'partial') {
    return (
      <Tag color="warning" icon={<ExclamationCircleOutlined />}>部分失败</Tag>
    );
  }
  return (
    <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>
  );
};

const renderItemState = (item: SubmissionMonitorItem) => {
  if (item.state === 'failed') {
    return <Tag color="error">失败</Tag>;
  }
  if (item.newly_scored) {
    return <Tag color="success">新出分</Tag>;
  }
  if (item.state === 'pending' || item.public_score === undefined || item.public_score === null) {
    return <Tag color="processing">待出分</Tag>;
  }
  return <Tag>已出分</Tag>;
};

const SubmissionMonitorControl: React.FC<SubmissionMonitorControlProps> = ({
  currentCompetition,
}) => {
  const [form] = Form.useForm<SubmissionMonitorConfig>();
  const [snapshot, setSnapshot] = useState<SubmissionMonitorSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latestEventCountRef = useRef(0);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<SubmissionMonitorRunLog | null>(null);
  const [runDetail, setRunDetail] = useState<SubmissionMonitorRunDetail | null>(null);
  const [detailSearch, setDetailSearch] = useState('');
  const [detailState, setDetailState] = useState<'all' | 'pending' | 'scored' | 'failed' | 'newly_scored'>('all');
  const [narrowViewport, setNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches,
  );
  const [enteredCompetitions, setEnteredCompetitions] = useState<EnteredCompetition[]>([]);
  const [enteredLoading, setEnteredLoading] = useState(false);
  const [enteredError, setEnteredError] = useState<string | null>(null);

  const loadStatus = useCallback(async (fillForm = false) => {
    try {
      const data = await api.getSubmissionMonitor();
      setSnapshot(data);
      setLoadError(null);
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
        });
      }
      return data;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '提交出分监控状态读取失败。');
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

  useEffect(() => {
    void loadStatus(false);
    const timer = window.setInterval(
      () => void loadStatus(false),
      open ? 5_000 : 30_000,
    );
    return () => window.clearInterval(timer);
  }, [loadStatus, open]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 900px)');
    const onChange = () => setNarrowViewport(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

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
      const data = await api.updateSubmissionMonitor(values);
      setSnapshot(data);
      form.setFieldsValue(data.config);
      message.success(values.enabled ? '提交出分监控已启用' : '提交出分监控配置已保存');
      return data;
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    let values: SubmissionMonitorConfig;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setRunning(true);
    try {
      await api.updateSubmissionMonitor(values);
      const data = await api.runSubmissionMonitor();
      setSnapshot(data);
      form.setFieldsValue(data.config);
      const newly = data.status.newly_scored_count;
      message.success(
        newly > 0
          ? `检查完成：新出分 ${newly} 条`
          : `检查完成：待出分 ${data.status.pending_count}，已出分 ${data.status.scored_count}`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '立即检查失败。');
      await loadStatus(false);
    } finally {
      setRunning(false);
    }
  };

  const showRunDetail = async (log: SubmissionMonitorRunLog) => {
    setSelectedLog(log);
    setRunDetail(null);
    setDetailError(null);
    setDetailSearch('');
    setDetailState('all');
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const detail = await api.getSubmissionMonitorLog(log.id);
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
      const state = item.state || (item.public_score == null ? 'pending' : 'scored');
      if (detailState === 'pending' && state !== 'pending') return false;
      if (detailState === 'scored' && (state !== 'scored' || item.newly_scored)) return false;
      if (detailState === 'failed' && state !== 'failed') return false;
      if (detailState === 'newly_scored' && !item.newly_scored) return false;
      if (!query) return true;
      return [item.ref, item.description, item.status, item.competition, item.submitted_by, item.submitted_by_ref, item.team_name, item.error_description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [detailSearch, detailState, runDetail?.items]);

  const detailColumns: TableColumnsType<SubmissionMonitorItem> = [
    {
      title: '竞赛',
      dataIndex: 'competition',
      key: 'competition',
      width: 150,
      ellipsis: true,
      render: (value?: string) => value || '—',
    },
    {
      title: 'Public LB',
      key: 'score',
      width: 120,
      render: (_, item) => formatScore(item),
    },
    {
      title: 'ref',
      dataIndex: 'ref',
      key: 'ref',
      width: 120,
      render: (value: string) => <Text code>{value}</Text>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (value?: string) => value || '（无描述）',
    },
    {
      title: '提交人',
      key: 'submitted_by',
      width: 140,
      ellipsis: true,
      render: (_, item) => item.submitted_by || item.submitted_by_ref || '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string | undefined, item) => item.error_description ? (
        <Tooltip title={item.error_description}>
          <Tag color="error">{value || '失败'}</Tag>
        </Tooltip>
      ) : value || '—',
    },
    {
      title: '结果',
      key: 'state',
      width: 100,
      render: (_, item) => renderItemState(item),
    },
    {
      title: '提交时间',
      dataIndex: 'date',
      key: 'date',
      width: 180,
      render: (value?: string) => formatDate(value),
    },
    {
      title: '监测到出分',
      dataIndex: 'scored_at',
      key: 'scored_at',
      width: 180,
      render: (value?: string) => formatDate(value),
    },
  ];

  const status = snapshot?.status;
  const enabled = snapshot?.config.enabled ?? false;
  const recentEvents: SubmissionScoreEvent[] = status?.recent_events || [];

  useEffect(() => {
    if (recentEvents.length > latestEventCountRef.current && latestEventCountRef.current > 0) {
      // 静默刷新即可；用户打开弹窗时能看到
    }
    latestEventCountRef.current = recentEvents.length;
  }, [recentEvents.length]);

  return (
    <>
      <Button
        className="submission-monitor-trigger"
        icon={<Activity size={15} strokeWidth={1.9} />}
        aria-label="提交出分监控"
        onClick={() => void showSettings()}
      >
        出分监控
      </Button>

      <Modal
        className="newapi-dialog submission-monitor-modal"
        title={(
          <DialogTitle disabled={running} onClose={() => !running && setOpen(false)}>
            <Space><Activity size={16} strokeWidth={1.9} />提交出分监控</Space>
          </DialogTitle>
        )}
        open={open}
        forceRender
        destroyOnClose={false}
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
          type="info"
          showIcon
          message="监控当前账号的竞赛提交 Public LB 出分"
          description="首次启用会建立基线，不会把已有分数当作新出分。之后仅在「无分 → 有分」时通过通知中心发送一次。通道与事件开关请在「通知中心」配置。"
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

        <Form<SubmissionMonitorConfig>
          form={form}
          layout="vertical"
          disabled={loading || running}
          initialValues={{
            enabled: false,
            competitions: currentCompetition ? [currentCompetition] : [],
            interval_minutes: 5,
            page_size: 10,
            description_prefix: '',
          }}
        >
          <Row gutter={16}>
            <Col xs={24} sm={12}>
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
                  aria-label="出分监控竞赛"
                  options={competitionSelectOptions}
                  maxTagCount="responsive"
                  maxTagTextLength={28}
                  listHeight={280}
                  popupMatchSelectWidth={false}
                  dropdownStyle={{ minWidth: 320 }}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item name="interval_minutes" label="刷新间隔" rules={[{ required: true }]}>
                <Select aria-label="出分监控刷新间隔" options={[
                  { value: 1, label: '1 分钟' },
                  { value: 2, label: '2 分钟' },
                  { value: 5, label: '5 分钟' },
                  { value: 10, label: '10 分钟' },
                  { value: 15, label: '15 分钟' },
                  { value: 30, label: '30 分钟' },
                  { value: 60, label: '1 小时' },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item
                name="page_size"
                label="每次拉取条数"
                tooltip="本人每日提交很少，默认 10 条足够覆盖近期待出分窗口"
                rules={[{ required: true }]}
              >
                <Select
                  aria-label="提交列表页大小"
                  options={[
                    { value: 5, label: '5 条' },
                    { value: 10, label: '10 条' },
                    { value: 15, label: '15 条' },
                    { value: 20, label: '20 条' },
                    { value: 30, label: '30 条' },
                    { value: 50, label: '50 条' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={16}>
              <Form.Item
                name="description_prefix"
                label="描述前缀过滤（可选）"
                extra="只监控 description 以该前缀开头的提交；留空表示全部"
              >
                <Input aria-label="提交描述前缀" placeholder="例如 dexp003 或 method-d" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="enabled" valuePropName="checked" label="定时任务" style={{ marginBottom: 16 }}>
                <Switch checkedChildren="已启用" unCheckedChildren="已关闭" />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <div className="auto-archive-summary-grid" role="group" aria-label="提交出分监控运行状态">
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
          <SummaryItem label="本轮提交" tabular>{status?.checked_count ?? 0}</SummaryItem>
          <SummaryItem label="待出分 / 已出分 / 失败" tabular>
            {status ? `${status.pending_count} / ${status.scored_count} / ${status.failed_count}` : '0 / 0 / 0'}
          </SummaryItem>
          <SummaryItem label="新出分" tabular>{status?.newly_scored_count ?? 0}</SummaryItem>
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

        <div className="dialog-section-heading" style={{ marginTop: 16 }}>
          <Text strong>最近新出分</Text>
          <Text type="secondary" className="dialog-section-hint">按 ref 去重，每个提交只通知一次</Text>
        </div>
        <List<SubmissionScoreEvent>
          size="small"
          dataSource={recentEvents}
          locale={{ emptyText: <Text type="secondary">尚无新出分事件</Text> }}
          renderItem={(event) => (
            <List.Item>
              <List.Item.Meta
                title={(
                  <Space size={8} wrap>
                    <Text strong>{event.public_score_display || event.public_score}</Text>
                    <Text type="secondary">ref {event.ref}</Text>
                    {event.status && <Tag>{event.status}</Tag>}
                  </Space>
                )}
                description={(
                  <Space size={12} wrap>
                    <span>{event.description || '（无描述）'}</span>
                    <Text type="secondary">{formatDate(event.date)}</Text>
                  </Space>
                )}
              />
            </List.Item>
          )}
          pagination={recentEvents.length > 5 ? { pageSize: 5 } : false}
        />

        <div className="dialog-section-heading" style={{ marginTop: 16 }}>
          <ClockCircleOutlined />
          <Text strong>运行记录</Text>
          <Text type="secondary" className="dialog-section-hint">点击查看本次检查到的提交明细</Text>
        </div>
        <List<SubmissionMonitorRunLog>
          className="auto-archive-log-list"
          size="small"
          dataSource={snapshot?.logs || []}
          pagination={{ pageSize: 5, hideOnSinglePage: true }}
          locale={{ emptyText: <Text type="secondary">尚未完成过检查</Text> }}
          renderItem={(log) => (
            <List.Item
              className="auto-archive-log-row"
              role="button"
              tabIndex={0}
              aria-label={`查看 ${formatDate(log.finished_at)} 的检查详情`}
              actions={[
                <Tooltip title="查看本次检查的提交明细" key="detail">
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
                    <Tag>{log.trigger === 'scheduled' ? '定时' : '手动'}</Tag>
                    {renderRunOutcome(log)}
                  </Space>
                )}
                description={(
                  <Space size={12} wrap>
                    <span>检查 <Text strong>{log.checked_count}</Text></span>
                    <span>待出分 <Text>{log.pending_count}</Text></span>
                    <span>已出分 <Text>{log.scored_count}</Text></span>
                    <span>失败 <Text type={log.failed_count > 0 ? 'danger' : undefined}>{log.failed_count}</Text></span>
                    <span>新出分 <Text type={log.newly_scored_count > 0 ? 'success' : undefined} strong>{log.newly_scored_count}</Text></span>
                    <Text type="secondary">耗时 {formatDuration(log.duration_seconds)}</Text>
                    {log.details_available === false && <Text type="secondary">仅汇总</Text>}
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
              <SummaryItem label="检查条数" tabular>{selectedLog.checked_count}</SummaryItem>
              <SummaryItem label="待出分 / 已出分 / 失败" tabular>
                {selectedLog.pending_count} / {selectedLog.scored_count} / {selectedLog.failed_count}
              </SummaryItem>
              <SummaryItem label="新出分" tabular>{selectedLog.newly_scored_count}</SummaryItem>
            </div>

            {selectedLog.error && (
              <Alert
                type="error"
                showIcon
                message="本次检查错误"
                description={selectedLog.error}
                style={{ marginTop: 16 }}
              />
            )}

            {!runDetail.log.details_available && (
              <Alert
                type="info"
                showIcon
                message="该记录创建于明细日志启用前，仅保留汇总数据。请再执行一次「立即检查」以生成可点击明细。"
                style={{ marginTop: 16 }}
              />
            )}

            {runDetail.log.details_available && (
              <>
                <Row gutter={[12, 12]} style={{ marginTop: 16, marginBottom: 12 }}>
                  <Col xs={24} sm={16}>
                    <Input
                      aria-label="筛选提交明细"
                      allowClear
                      prefix={<SearchOutlined />}
                      value={detailSearch}
                      placeholder="筛选 ref、描述、提交人或状态"
                      onChange={(event) => setDetailSearch(event.target.value)}
                    />
                  </Col>
                  <Col xs={24} sm={8}>
                    <Select
                      aria-label="提交明细状态筛选"
                      value={detailState}
                      style={{ width: '100%' }}
                      onChange={setDetailState}
                      options={[
                        { value: 'all', label: '全部提交' },
                        { value: 'pending', label: '待出分' },
                        { value: 'scored', label: '已出分' },
                        { value: 'failed', label: '失败' },
                        { value: 'newly_scored', label: '新出分' },
                      ]}
                    />
                  </Col>
                </Row>
                <div className="desktop-data-table">
                  <Table<SubmissionMonitorItem>
                    size="small"
                    rowKey="ref"
                    columns={detailColumns}
                    dataSource={detailItems}
                    pagination={{
                      defaultPageSize: 10,
                      pageSizeOptions: [10, 25, 50],
                      showSizeChanger: true,
                      showTotal: (total) => `显示 ${total} / ${runDetail.items.length} 条提交`,
                    }}
                    scroll={{ x: 900 }}
                  />
                </div>
                <div className="mobile-data-list auto-archive-detail-list">
                  {!detailItems.length && <Empty description="没有符合条件的提交" />}
                  {detailItems.map((item) => (
                    <article className="mobile-data-card" key={item.ref}>
                      <div className="mobile-data-card-head">
                        <div className="mobile-data-card-title">
                          <span className="kernel-title">{item.description || '（无描述）'}</span>
                          <span className="kernel-ref">ref {item.ref}</span>
                        </div>
                        <span className="score-value">{formatScore(item)}</span>
                      </div>
                      <div className="mobile-data-card-meta">
                        <span>{item.status || '—'}</span>
                        <span>{formatDate(item.date)}</span>
                        <span>监测到出分 {formatDate(item.scored_at)}</span>
                        <span>{item.submitted_by || item.submitted_by_ref || '提交人未知'}</span>
                        {renderItemState(item)}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        ) : null}
      </Drawer>
    </>
  );
};

export default SubmissionMonitorControl;
