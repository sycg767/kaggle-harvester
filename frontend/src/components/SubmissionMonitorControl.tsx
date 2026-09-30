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
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { Activity } from 'lucide-react';
import {
  api,
  type EnteredCompetition,
  type SubmissionMonitorConfig,
  type SubmissionMonitorRunDetail,
  type SubmissionMonitorRunLog,
  type SubmissionMonitorSnapshot,
  type SubmissionScoreEvent,
} from '../api';
import { buildEnteredCompetitionOptions } from '../competitionOptions';
import { getEnteredCompetitions } from '../enteredCompetitionsCache';
import DialogTitle from './DialogTitle';
import {
  formatDate,
  SubmissionConfigForm,
  SubmissionDetailDrawer,
  SubmissionEventsList,
  SubmissionRunLogsList,
  SummaryItem,
} from './submission-monitor';

interface SubmissionMonitorControlProps {
  currentCompetition: string;
  buttonText?: string;
  buttonIcon?: React.ReactNode;
}

const SubmissionMonitorControl: React.FC<SubmissionMonitorControlProps> = ({
  currentCompetition,
  buttonText,
  buttonIcon,
}) => {
  const { message } = AntApp.useApp();
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

  const status = snapshot?.status;
  const enabled = snapshot?.config.enabled ?? false;
  const recentEvents: SubmissionScoreEvent[] = status?.recent_events || [];

  useEffect(() => {
    latestEventCountRef.current = recentEvents.length;
  }, [recentEvents.length]);

  return (
    <>
      <Button
        size={buttonText ? 'small' : undefined}
        className="submission-monitor-trigger"
        icon={buttonIcon || <Activity size={15} strokeWidth={1.9} />}
        aria-label={buttonText || '提交出分监控'}
        onClick={() => void showSettings()}
      >
        {buttonText || '出分监控'}
      </Button>

      <Modal
        className="app-modal submission-monitor-modal"
        title={(
          <DialogTitle
            icon={<Activity size={17} color="#007aff" strokeWidth={2.2} />}
            title="提交出分监控"
            subtitle="后台自动轮询排队与评估状态，命中出分即时通知"
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
          <Text strong style={{ fontSize: 13.5 }}>监控配置</Text>
        </div>

        <SubmissionConfigForm
          form={form}
          disabled={loading || running}
          competitionSelectOptions={competitionSelectOptions}
          enteredLoading={enteredLoading}
          enteredError={enteredError}
          onRefreshCompetitions={() => void loadEnteredCompetitions(true)}
          currentCompetition={currentCompetition}
        />

        <div className="dialog-section-heading" style={{ marginTop: 20, marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13.5 }}>状态摘要</Text>
        </div>

        <div className="dialog-summary-grid" role="group" aria-label="提交出分监控运行状态">
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
            <span className="dialog-summary-label">待出分 / 已出分 / 失败</span>
            <span className="dialog-summary-value">
              {status ? `${status.pending_count} / ${status.scored_count} / ${status.failed_count}` : '0 / 0 / 0'}
            </span>
          </div>
          <div className="dialog-summary-cell">
            <span className="dialog-summary-label">新出分</span>
            <span className="dialog-summary-value">{status?.newly_scored_count ?? 0}</span>
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

        <SubmissionEventsList events={recentEvents} />

        <div className="dialog-section-heading" style={{ marginTop: 20, marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13.5 }}>运行记录</Text>
        </div>

        <SubmissionRunLogsList
          logs={snapshot?.logs || []}
          onSelectLog={(log) => void showRunDetail(log)}
        />
      </Modal>

      <SubmissionDetailDrawer
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

export default SubmissionMonitorControl;
