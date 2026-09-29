import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Modal,
  Space,
  Spin,
} from 'antd';
import { Swords } from 'lucide-react';
import {
  api,
  type SimulationAgentStats,
  type SimulationClawbotTestResult,
  type SimulationMonitorConfig,
  type SimulationMonitorRunDetail,
  type SimulationMonitorSnapshot,
} from '../api';
import DialogTitle from './DialogTitle';
import {
  ActiveBattleDashboard,
  AliasEditModal,
  CandidateSubmissionsView,
  ClawbotModal,
  HistoryModal,
  RunDetailModal,
  SettingsDrawer,
  SimControlBar,
  type AvailableSubmissionItem,
  useSimulationEpisodes,
} from './simulation';

interface SimulationMonitorControlProps {
  currentCompetition?: string;
  buttonText?: string;
  buttonIcon?: React.ReactNode;
}

export const SimulationMonitorControl: React.FC<SimulationMonitorControlProps> = ({
  currentCompetition,
  buttonText,
  buttonIcon,
}) => {
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState<SimulationMonitorSnapshot | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [logDetail, setLogDetail] = useState<SimulationMonitorRunDetail | null>(null);
  const [logDetailLoading, setLogDetailLoading] = useState(false);
  const [clawbotOpen, setClawbotOpen] = useState(false);
  const [testingClawbot, setTestingClawbot] = useState(false);
  const [clawbotTestResult, setClawbotTestResult] = useState<SimulationClawbotTestResult | null>(null);
  const [availableSubmissions, setAvailableSubmissions] = useState<AvailableSubmissionItem[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [form] = Form.useForm<SimulationMonitorConfig>();
  const watchedTargetIds = Form.useWatch('target_submission_ids', form) || [];
  const [submissionAliases, setSubmissionAliases] = useState<Record<string, string>>({});

  // Quick edit alias modal state
  const [aliasModalOpen, setAliasModalOpen] = useState(false);
  const [editingSubId, setEditingSubId] = useState<number | null>(null);
  const [editingAliasValue, setEditingAliasValue] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const openEditAliasModal = (subId: number, currentAlias: string) => {
    setEditingSubId(subId);
    setEditingAliasValue(submissionAliases[String(subId)] || currentAlias || '');
    setAliasModalOpen(true);
  };

  const handleSaveAlias = async () => {
    if (!editingSubId) return;
    setSavingAlias(true);
    try {
      const nextAliases = {
        ...submissionAliases,
        [String(editingSubId)]: editingAliasValue.trim(),
      };
      setSubmissionAliases(nextAliases);
      if (snapshot?.config) {
        const updated = await api.updateSimulationMonitor({
          ...snapshot.config,
          submission_aliases: nextAliases,
        });
        setSnapshot(updated);
        message.success(`已更新 Agent #${editingSubId} 别名为「${editingAliasValue.trim() || '默认'}」`);
      }
      setAliasModalOpen(false);
    } catch (err: any) {
      message.error(`保存别名失败: ${err.message}`);
    } finally {
      if (isMounted.current) setSavingAlias(false);
    }
  };

  const targetCompetition = currentCompetition || snapshot?.config?.competition || 'pokemon-tcg-ai-battle';
  const isTargetCompActive = Boolean(snapshot?.config?.competition && snapshot.config.competition === targetCompetition);
  const targetCompTitle = targetCompetition === 'pokemon-tcg-ai-battle'
    ? 'Pokemon TCG AI Battle'
    : targetCompetition === 'kaggriculture'
    ? 'Kaggriculture 智能体农场模拟'
    : targetCompetition;

  const fetchAvailableSubmissions = useCallback(async (comp?: string) => {
    setLoadingSubmissions(true);
    try {
      const compSlug = comp || targetCompetition;
      const subs = await api.listSimulationSubmissions(compSlug);
      if (isMounted.current) setAvailableSubmissions(subs);
    } catch {
      // quiet failback
    } finally {
      if (isMounted.current) setLoadingSubmissions(false);
    }
  }, [targetCompetition]);

  useEffect(() => {
    if (settingsOpen) {
      const compToFetch = form.getFieldValue('competition') || targetCompetition;
      void fetchAvailableSubmissions(compToFetch);
    }
  }, [settingsOpen, fetchAvailableSubmissions, targetCompetition, form]);

  const fetchSnapshot = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await api.getSimulationMonitor();
      if (isMounted.current) {
        setSnapshot(data);
        const activeComp = data.config.competition || 'pokemon-tcg-ai-battle';
        const compToUse = currentCompetition || activeComp;
        const isCurrent = (activeComp === compToUse);

        if (data.config.submission_aliases) {
          setSubmissionAliases(data.config.submission_aliases);
        }

        form.setFieldsValue({
          enabled: isCurrent ? data.config.enabled : false,
          competition: compToUse,
          interval_minutes: data.config.interval_minutes || 10,
          bronze_percentile: data.config.bronze_percentile || 0.10,
          target_submission_ids: isCurrent
            ? (data.config.target_submission_ids || data.config.submission_ids || [])
            : [],
          notify_on_new_matches: data.config.notify_on_new_matches ?? data.config.notify_on_new_episodes ?? true,
          notify_on_medal_change: data.config.notify_on_medal_change ?? true,
        });
      }
    } catch (err: any) {
      if (isMounted.current && !quiet) {
        message.error(`获取模拟对战监控状态失败: ${err.message}`);
      }
    } finally {
      if (isMounted.current && !quiet) setLoading(false);
    }
  }, [form, message, currentCompetition]);

  const handleTestClawbot = async () => {
    setTestingClawbot(true);
    try {
      const res = await api.testClawbot();
      setClawbotTestResult(res);
      if (res.success) {
        message.success(res.message);
      } else {
        message.warning(res.message);
      }
      await fetchSnapshot(true);
    } catch (err: any) {
      message.error(`网关探测失败: ${err.message}`);
    } finally {
      setTestingClawbot(false);
    }
  };

  useEffect(() => {
    if (open) {
      void fetchSnapshot();
      if (!isTargetCompActive) {
        void fetchAvailableSubmissions(targetCompetition);
      }
    }
  }, [open, fetchSnapshot, isTargetCompActive, fetchAvailableSubmissions, targetCompetition]);

  const handleRunNow = async () => {
    setRunningNow(true);
    try {
      const updated = await api.runSimulationMonitor();
      setSnapshot(updated);
      message.success('已触发模拟对战最新轮次检查并成功刷新数据！');
    } catch (err: any) {
      message.error(`立即检查失败: ${err.message}`);
    } finally {
      setRunningNow(false);
    }
  };

  const handleSaveConfig = async (values: SimulationMonitorConfig) => {
    setSaving(true);
    try {
      const updated = await api.updateSimulationMonitor({
        ...values,
        submission_aliases: submissionAliases,
      });
      setSnapshot(updated);
      setSettingsOpen(false);
      message.success('已保存模拟对战监控配置！');
      void fetchSnapshot(true);
    } catch (err: any) {
      message.error(`保存配置失败: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleViewLogDetail = async (logId: string) => {
    setSelectedLogId(logId);
    setLogDetailLoading(true);
    try {
      const detail = await api.getSimulationMonitorLog(logId);
      setLogDetail(detail);
    } catch (err: any) {
      message.error(`读取明细失败: ${err.message}`);
    } finally {
      setLogDetailLoading(false);
    }
  };

  const status = snapshot?.status;
  const agents = status?.agents || [];
  const thresholds = status?.thresholds || status?.medal_thresholds;

  const { episodePages, episodeLoading, fetchEpisodePage } = useSimulationEpisodes({
    open,
    isTargetCompActive,
    agents,
    onError: (err) => message.error(`读取对局流水失败: ${err.message}`),
  });

  const getAgentMedal = useCallback((agent: SimulationAgentStats) => {
    const sc = agent.score ?? agent.public_score;
    if (thresholds && sc !== undefined && sc !== null) {
      if (
        thresholds.gold_cutoff_score !== undefined &&
        thresholds.gold_cutoff_score !== null &&
        sc >= thresholds.gold_cutoff_score
      ) {
        return 'gold';
      }
      if (
        thresholds.silver_cutoff_score !== undefined &&
        thresholds.silver_cutoff_score !== null &&
        sc >= thresholds.silver_cutoff_score
      ) {
        return 'silver';
      }
      if (
        thresholds.bronze_cutoff_score !== undefined &&
        thresholds.bronze_cutoff_score !== null &&
        sc >= thresholds.bronze_cutoff_score
      ) {
        return 'bronze';
      }
    }
    return agent.medal_tier || undefined;
  }, [thresholds]);

  const agent1 = agents[0];
  const agent2 = agents[1];

  const agent1Page = agent1 ? episodePages[agent1.submission_id] : undefined;
  const agent2Page = agent2 ? episodePages[agent2.submission_id] : undefined;

  const agent1Episodes = agent1Page?.episodes ?? [];
  const agent2Episodes = agent2Page?.episodes ?? [];

  const getRatedEpisodeCount = (agent?: SimulationAgentStats) => (
    Math.max(0, (agent?.total_episodes || 0) - (agent?.system_checks || 0))
  );
  const totalTrackedCount = getRatedEpisodeCount(agent1) + getRatedEpisodeCount(agent2);
  const isMonitoringActive = Boolean(snapshot?.config?.enabled);

  return (
    <>
      <Button
        icon={buttonIcon || <Swords size={14} />}
        onClick={() => setOpen(true)}
        style={{ borderRadius: 6, fontSize: 12, fontWeight: 500 }}
      >
        {buttonText || '天梯对战监控'}
      </Button>

      {/* Main Dashboard Modal */}
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        closable={false}
        width={1120}
        footer={null}
        title={(
          <DialogTitle onClose={() => setOpen(false)}>
            <Space size={8} align="center">
              <Swords size={16} color="#d97706" strokeWidth={2.2} />
              <span style={{ fontWeight: 600, fontSize: 16 }}>{targetCompTitle} — 智能体对战与天梯监控</span>
            </Space>
          </DialogTitle>
        )}
        className="simulation-monitor-modal"
      >
        <Spin spinning={loading && !snapshot}>
          <div style={{ paddingTop: 4 }}>
            {/* Header Control Bar */}
            <SimControlBar
              isTargetCompActive={isTargetCompActive}
              isMonitoringActive={isMonitoringActive}
              status={status}
              config={snapshot?.config}
              targetCompTitle={targetCompTitle}
              targetCompetition={targetCompetition}
              runningNow={runningNow}
              loadingSubmissions={loadingSubmissions}
              onOpenClawbot={() => setClawbotOpen(true)}
              onOpenSettings={() => {
                form.setFieldsValue({ competition: targetCompetition });
                setSettingsOpen(true);
              }}
              onOpenHistory={() => setHistoryOpen(true)}
              onRunNow={handleRunNow}
              onRefreshSubmissions={() => void fetchAvailableSubmissions(targetCompetition)}
            />

            {/* Error or Warning Alert */}
            {status?.last_error && (
              <Alert
                message="对战状态检查提示"
                description={status.last_error}
                type="warning"
                showIcon
                closable
                style={{ marginBottom: 14, borderRadius: 8 }}
              />
            )}

            {!isTargetCompActive ? (
              <CandidateSubmissionsView
                targetCompTitle={targetCompTitle}
                targetCompetition={targetCompetition}
                isMonitoringActive={isMonitoringActive}
                activeMonitoredCompetition={snapshot?.config?.competition}
                availableSubmissions={availableSubmissions}
                loadingSubmissions={loadingSubmissions}
                onQuickEnable={() => {
                  const topSubs = availableSubmissions
                    .filter((s) => s.status?.toLowerCase().includes('complete') || s.status?.toLowerCase().includes('success'))
                    .slice(0, 2)
                    .map((s) => s.submission_id);
                  form.setFieldsValue({
                    enabled: true,
                    competition: targetCompetition,
                    target_submission_ids: topSubs.length > 0 ? topSubs : availableSubmissions.slice(0, 2).map((s) => s.submission_id),
                  });
                  setSettingsOpen(true);
                }}
                onRefreshSubmissions={() => void fetchAvailableSubmissions(targetCompetition)}
                onSelectSubmissionAsTarget={(subId) => {
                  const currentSelected: number[] = form.getFieldValue('target_submission_ids') || [];
                  const nextSelected = currentSelected.includes(subId)
                    ? currentSelected
                    : [...currentSelected, subId].slice(-2);
                  form.setFieldsValue({
                    enabled: true,
                    competition: targetCompetition,
                    target_submission_ids: nextSelected,
                  });
                  setSettingsOpen(true);
                  message.info(`已选定智能体 #${subId}，请确认配置后点击保存开启监控`);
                }}
                onCopyId={(subId) => {
                  void navigator.clipboard?.writeText(String(subId));
                  message.success(`已复制提交 ID: #${subId}`);
                }}
              />
            ) : (
              <ActiveBattleDashboard
                thresholds={thresholds}
                agents={agents}
                getAgentMedal={getAgentMedal}
                openEditAliasModal={openEditAliasModal}
                getRatedEpisodeCount={getRatedEpisodeCount}
                totalTrackedCount={totalTrackedCount}
                agent1={agent1}
                agent2={agent2}
                agent1Episodes={agent1Episodes}
                agent2Episodes={agent2Episodes}
                agent1Page={agent1Page}
                agent2Page={agent2Page}
                episodeLoading={episodeLoading}
                fetchEpisodePage={fetchEpisodePage}
              />
            )}
          </div>
        </Spin>
      </Modal>

      {/* Settings Drawer */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        form={form}
        onFinish={handleSaveConfig}
        saving={saving}
        targetCompetition={targetCompetition}
        loadingSubmissions={loadingSubmissions}
        availableSubmissions={availableSubmissions}
        watchedTargetIds={watchedTargetIds}
        submissionAliases={submissionAliases}
        setSubmissionAliases={setSubmissionAliases}
        fetchAvailableSubmissions={fetchAvailableSubmissions}
      />

      {/* History & Run Logs Modal */}
      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        logs={snapshot?.logs || []}
        selectedLogId={selectedLogId}
        logDetailLoading={logDetailLoading}
        onViewDetail={handleViewLogDetail}
      />

      {/* Selected Run Detail Modal */}
      <RunDetailModal
        open={Boolean(selectedLogId)}
        onClose={() => {
          setSelectedLogId(null);
          setLogDetail(null);
        }}
        logDetail={logDetail}
        loading={logDetailLoading}
      />

      {/* WeChat ClawBot Assistant Modal */}
      <ClawbotModal
        open={clawbotOpen}
        onClose={() => setClawbotOpen(false)}
        status={status}
        testing={testingClawbot}
        testResult={clawbotTestResult}
        onTest={handleTestClawbot}
      />

      {/* Quick Edit Agent Alias Modal */}
      <AliasEditModal
        open={aliasModalOpen}
        onClose={() => setAliasModalOpen(false)}
        subId={editingSubId}
        aliasValue={editingAliasValue}
        onChangeAliasValue={setEditingAliasValue}
        saving={savingAlias}
        onSave={handleSaveAlias}
      />
    </>
  );
};

export default SimulationMonitorControl;
