import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Modal,
  Space,
  Tag,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { Gauge } from 'lucide-react';
import {
  api,
  type AutoArchiveConfig,
  type AutoArchiveRunDetail,
  type AutoArchiveRunLog,
  type AutoArchiveSnapshot,
  type EnteredCompetition,
} from '../api';
import { buildEnteredCompetitionOptions, competitionDisplayName } from '../competitionOptions';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import DialogTitle from './DialogTitle';
import {
  AutoArchiveConfigForm,
  AutoArchiveDetailDrawer,
  AutoArchiveLogsList,
  formatDate,
  SummaryItem,
} from './auto-archive';

interface AutoArchiveControlProps {
  currentCompetition: string;
  onArchiveComplete?: () => void;
  buttonText?: string;
  buttonIcon?: React.ReactNode;
}

const AutoArchiveControl: React.FC<AutoArchiveControlProps> = ({
  currentCompetition,
  onArchiveComplete,
  buttonText,
  buttonIcon,
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
  const [narrowViewport, setNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
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
    if (typeof window === 'undefined') return undefined;
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
    () => buildEnteredCompetitionOptions(
      enteredCompetitions,
      [
        ...(snapshot?.config.competitions || []),
        currentCompetition,
      ],
      {
        currentSlug: currentCompetition,
        excludeEnded: true,
      },
    ),
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
        {enabled && !buttonText && <Tag color="success">已启用</Tag>}
        <Button
          size={buttonText ? 'small' : undefined}
          icon={buttonIcon || <ClockCircleOutlined />}
          aria-label={buttonText || '自动归档'}
          onClick={() => void showSettings()}
        >
          {buttonText || '自动归档'}
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

        <AutoArchiveConfigForm
          form={form}
          disabled={loading || running}
          competitionSelectOptions={competitionSelectOptions}
          competitionTitleById={competitionTitleById}
          enteredLoading={enteredLoading}
          enteredError={enteredError}
          onRefreshCompetitions={() => void loadEnteredCompetitions(true)}
          currentCompetition={currentCompetition}
        />

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

        <AutoArchiveLogsList
          logs={snapshot?.logs || []}
          onSelectLog={(log) => void showRunDetail(log)}
        />
      </Modal>

      <AutoArchiveDetailDrawer
        open={detailOpen}
        loading={detailLoading}
        error={detailError}
        selectedLog={selectedLog}
        runDetail={runDetail}
        narrowViewport={narrowViewport}
        onClose={() => setDetailOpen(false)}
      />
    </>
  );
};

export default AutoArchiveControl;
