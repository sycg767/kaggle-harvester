import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';

const { Text } = Typography;
import {
  ClockCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
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
        className="app-modal auto-archive-modal"
        title={(
          <DialogTitle
            icon={<ClockCircleOutlined style={{ color: '#007aff' }} />}
            title="自动归档设置"
            subtitle="后台定时巡检并保存高质量开源代码与输出文件"
            disabled={running}
            onClose={() => !running && setOpen(false)}
          />
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

        <div className="dialog-section-heading" style={{ marginBottom: 10 }}>
          <Text strong style={{ fontSize: 13.5 }}>配置</Text>
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

        <div className="dialog-section-heading" style={{ marginTop: 20, marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13.5 }}>运行状态</Text>
        </div>

        <div className="dialog-summary-grid" role="group" aria-label="自动归档运行状态">
          <div className="dialog-summary-cell">
            <span className="dialog-summary-label">任务状态</span>
            <span className="dialog-summary-value">
              {!status?.scheduler_alive
                ? <span className="dialog-status-pill is-error">调度器离线</span>
                : status?.running
                ? <span className="dialog-status-pill is-running">正在检查</span>
                : enabled
                  ? <span className="dialog-status-pill is-success">等待下次检查</span>
                  : <span className="dialog-status-pill is-default">已关闭</span>}
            </span>
          </div>
          <div className="dialog-summary-cell">
            <span className="dialog-summary-label">监控竞赛</span>
            <span className="dialog-summary-value">
              {snapshot?.config.competitions?.length
                ? `${snapshot.config.competitions.length} 个`
                : '—'}
            </span>
          </div>
          <div className="dialog-summary-cell">
            <span className="dialog-summary-label">最近检查</span>
            <span className="dialog-summary-value">{formatDate(status?.last_checked_at)}</span>
          </div>
          <div className="dialog-summary-cell">
            <span className="dialog-summary-label">下次检查</span>
            <span className="dialog-summary-value">{formatDate(status?.next_run_at)}</span>
          </div>
          <div className="dialog-summary-cell">
            <span className="dialog-summary-label">本地新增</span>
            <span className="dialog-summary-value">{status?.archived_count ?? 0}</span>
          </div>
          <div className="dialog-summary-cell">
            <span className="dialog-summary-label">已存在 / 失败</span>
            <span className="dialog-summary-value">
              {status ? `${status.skipped_count} / ${status.failed_count}` : '0 / 0'}
            </span>
          </div>
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

        <div className="dialog-section-heading" style={{ marginTop: 20, marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13.5 }}>运行记录</Text>
        </div>

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
