import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
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
  ExportOutlined,
  EyeOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveOutlined,
  SettingOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { Swords, Award, Flame, MessageCircle, Bot, Zap } from 'lucide-react';
import {
  api,
  type SimulationAgentStats,
  type SimulationClawbotTestResult,
  type SimulationEpisode,
  type SimulationMedalThresholds,
  type SimulationMonitorConfig,
  type SimulationMonitorRunDetail,
  type SimulationMonitorRunLog,
  type SimulationMonitorSnapshot,
} from '../api';
import DialogTitle from './DialogTitle';

const { Text, Title } = Typography;

interface SimulationMonitorControlProps {
  currentCompetition?: string;
}

const formatDate = (value?: string) => {
  if (!value) return '—';
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

const formatShortTime = (value?: string) => {
  if (!value) return '—';
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
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDuration = (seconds: number) => {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
};

const getMedalTag = (tier?: string) => {
  if (tier === 'gold') {
    return <Tag color="gold" icon={<TrophyOutlined />}>金牌线内</Tag>;
  }
  if (tier === 'silver') {
    return (
      <Tag
        color="default"
        style={{ borderColor: '#cbd5e1', background: '#f1f5f9', color: '#475569' }}
        icon={<TrophyOutlined />}
      >
        银牌线内
      </Tag>
    );
  }
  if (tier === 'bronze') {
    return <Tag color="orange" icon={<TrophyOutlined />}>铜牌线内</Tag>;
  }
  return <Tag color="default">暂无奖牌</Tag>;
};

const getShortAgentName = (agent: SimulationAgentStats, defaultIdx: number) => {
  const raw = (agent.description || agent.file_name || '').trim();
  const match = raw.match(/^(p\d+(?:plus\d+)?|p\d+|[a-zA-Z0-9_\-]+)/i);
  if (match) {
    let name = match[1];
    if (/^p3plus31/i.test(name)) name = 'p31';
    name = name.replace(/[:_\-—]+$/, '');
    if (name.length <= 14) {
      return name;
    }
  }
  const fileMatch = (agent.file_name || '').match(/^(p\d+(?:plus\d+)?|p\d+)/i);
  if (fileMatch) {
    let name = fileMatch[1];
    if (/^p3plus31/i.test(name)) name = 'p31';
    return name;
  }
  return `Agent #${defaultIdx + 1}`;
};

export const SimulationMonitorControl: React.FC<SimulationMonitorControlProps> = ({
  currentCompetition,
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
  const [availableSubmissions, setAvailableSubmissions] = useState<Array<{
    submission_id: number;
    description: string;
    file_name: string;
    date: string;
    status: string;
    public_score?: number | null;
    team_name?: string;
  }>>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  const fetchAvailableSubmissions = useCallback(async (comp?: string) => {
    setLoadingSubmissions(true);
    try {
      const subs = await api.listSimulationSubmissions(comp || currentCompetition);
      if (isMounted.current) setAvailableSubmissions(subs);
    } catch {
      // quiet failback
    } finally {
      if (isMounted.current) setLoadingSubmissions(false);
    }
  }, [currentCompetition]);

  useEffect(() => {
    if (settingsOpen) {
      void fetchAvailableSubmissions(snapshot?.config?.competition);
    }
  }, [settingsOpen, fetchAvailableSubmissions, snapshot?.config?.competition]);

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

  const [form] = Form.useForm<SimulationMonitorConfig>();
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchSnapshot = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await api.getSimulationMonitor();
      if (isMounted.current) {
        setSnapshot(data);
        form.setFieldsValue({
          enabled: data.config.enabled,
          competition: data.config.competition,
          interval_minutes: data.config.interval_minutes,
          bronze_percentile: data.config.bronze_percentile,
          target_submission_ids: data.config.target_submission_ids || data.config.submission_ids,
          notify_on_new_matches: data.config.notify_on_new_matches ?? data.config.notify_on_new_episodes,
          notify_on_medal_change: data.config.notify_on_medal_change,
        });
      }
    } catch (err: any) {
      if (isMounted.current && !quiet) {
        message.error(`获取模拟对战监控状态失败: ${err.message}`);
      }
    } finally {
      if (isMounted.current && !quiet) setLoading(false);
    }
  }, [form, message]);

  // Initial fetch and auto-poll
  useEffect(() => {
    fetchSnapshot(true);
    const timer = setInterval(() => {
      fetchSnapshot(true);
    }, 30000);
    return () => clearInterval(timer);
  }, [fetchSnapshot]);

  const handleOpen = () => {
    setOpen(true);
    fetchSnapshot(true);
  };

  const handleRunNow = async () => {
    setRunningNow(true);
    try {
      const result = await api.runSimulationMonitor();
      setSnapshot(result);
      message.success('已触发即时对战与排行榜刷新！');
    } catch (err: any) {
      message.error(`执行刷新失败: ${err.message}`);
    } finally {
      if (isMounted.current) setRunningNow(false);
    }
  };

  const handleSaveConfig = async (values: any) => {
    setSaving(true);
    try {
      const updated = await api.updateSimulationMonitor({
        ...values,
        notify_on_new_episodes: values.notify_on_new_matches,
        target_submission_ids: (values.target_submission_ids || []).map((v: any) => Number(v)),
      });
      setSnapshot(updated);
      setSettingsOpen(false);
      message.success('模拟对战监控配置已更新！');
    } catch (err: any) {
      message.error(`保存配置失败: ${err.message}`);
    } finally {
      if (isMounted.current) setSaving(false);
    }
  };

  const handleViewLogDetail = async (logId: string) => {
    setSelectedLogId(logId);
    setLogDetailLoading(true);
    try {
      const detail = await api.getSimulationMonitorLog(logId);
      if (isMounted.current) setLogDetail(detail);
    } catch (err: any) {
      if (isMounted.current) message.error(`读取日志明细失败: ${err.message}`);
    } finally {
      if (isMounted.current) setLogDetailLoading(false);
    }
  };

  const status = snapshot?.status;
  const config = snapshot?.config;
  const agents = status?.agents || [];
  const thresholds = status?.thresholds || status?.medal_thresholds;

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
      return 'none';
    }
    return 'none';
  }, [thresholds]);

  const agent1 = agents[0];
  const agent2 = agents[1];
  const agent1Episodes = agent1?.recent_episodes || [];
  const agent2Episodes = agent2?.recent_episodes || [];

  // Table columns for each agent stream with Replay integrated into Episode ID and score change displayed
  const sideEpisodeColumns: TableColumnsType<SimulationEpisode> = useMemo(() => [
    {
      title: '对局 ID',
      dataIndex: 'id',
      key: 'id',
      width: 105,
      render: (id: number, record) => (
        <Tooltip title="点击在 Kaggle 查看官方对战回放 ↗">
          <a
            href={record.replay_url}
            target="_blank"
            rel="noopener noreferrer"
            className="sim-episode-link"
          >
            #{id}
            <ExportOutlined style={{ fontSize: 11 }} />
          </a>
        </Tooltip>
      ),
    },
    {
      title: '时间',
      dataIndex: 'create_time',
      key: 'create_time',
      width: 100,
      render: (time: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatShortTime(time)}
        </Text>
      ),
    },
    {
      title: '对手队伍',
      dataIndex: 'opponent_team_name',
      key: 'opponent_team_name',
      ellipsis: true,
      render: (name: string, record) => {
        const scoreLabel = record.opponent_score ? ` (${record.opponent_score.toFixed(0)}分)` : '';
        return (
          <Tooltip title={record.opponent_submission_id ? `${name}${scoreLabel} (Sub #${record.opponent_submission_id})` : `${name}${scoreLabel}`}>
            <Text style={{ fontSize: 12 }} ellipsis>
              {name || '对手'}{record.opponent_score ? <span style={{ color: '#94a3b8', fontSize: 11 }}> ({record.opponent_score.toFixed(0)})</span> : null}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: (
        <Tooltip title="Kaggle 官方真实对战结算天梯分加减（+ 代表获胜加分，- 代表战败扣分）">
          <span style={{ cursor: 'help', borderBottom: '1px dashed #94a3b8' }}>
            天梯变动
          </span>
        </Tooltip>
      ),
      dataIndex: 'result',
      key: 'result',
      width: 95,
      align: 'center',
      render: (res: string, record) => {
        const delta = record.score_delta;
        if (res === 'win' || record.reward === 1) {
          const deltaStr = delta !== undefined && delta !== null ? `+${Math.abs(delta).toFixed(1)}` : '+3.0';
          return (
            <Tag color="success" style={{ margin: 0, fontSize: 12, fontWeight: 800, borderRadius: 6, minWidth: 50, textAlign: 'center' }}>
              {deltaStr}
            </Tag>
          );
        }
        if (res === 'loss' || record.reward === -1) {
          const deltaStr = delta !== undefined && delta !== null ? `-${Math.abs(delta).toFixed(1)}` : '-3.0';
          return (
            <Tag color="error" style={{ margin: 0, fontSize: 12, fontWeight: 800, borderRadius: 6, minWidth: 50, textAlign: 'center' }}>
              {deltaStr}
            </Tag>
          );
        }
        if (res === 'tie' || record.reward === 0) {
          return (
            <Tag color="default" style={{ margin: 0, fontSize: 12, fontWeight: 800, borderRadius: 6, minWidth: 50, textAlign: 'center' }}>
              0.0
            </Tag>
          );
        }
        return (
          <Tag color="processing" style={{ margin: 0, fontSize: 11, borderRadius: 6 }}>
            进行中
          </Tag>
        );
      },
    },
  ], []);

  const totalTrackedCount = (agent1?.total_episodes || 0) + (agent2?.total_episodes || 0);
  const isMonitoringActive = Boolean(snapshot?.config?.enabled);

  return (
    <>
      {/* Top Bar Trigger Button */}
      <Tooltip title="Pokemon TCG 对战天梯与双代理战绩监控" open={open ? false : undefined}>
        <Button
          type="default"
          icon={<Swords size={15} className="text-amber-500" strokeWidth={2} />}
          onClick={handleOpen}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 500 }}
        >
          <span>对战监控</span>
          {agents.length > 0 && (
            <Tag
              color={status?.running ? 'processing' : 'default'}
              style={{ marginLeft: 4, marginRight: 0, borderRadius: 10, fontSize: 11 }}
            >
              {(agents[0]?.score ?? agents[0]?.public_score) !== undefined && (agents[0]?.score ?? agents[0]?.public_score) !== null
                ? `${Number(agents[0]?.score ?? agents[0]?.public_score).toFixed(1)}分`
                : isMonitoringActive ? '活跃' : '已暂停'}
            </Tag>
          )}
        </Button>
      </Tooltip>

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
              <span style={{ fontWeight: 600, fontSize: 16 }}>Pokemon TCG AI Battle — 双代理对战与天梯监控</span>
            </Space>
          </DialogTitle>
        )}
        className="simulation-monitor-modal"
      >
        <Spin spinning={loading && !snapshot}>
          <div style={{ paddingTop: 4 }}>
            {/* Header Control Bar */}
            <div className="sim-control-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: isMonitoringActive ? '#10b981' : '#94a3b8',
                      boxShadow: isMonitoringActive ? '0 0 0 3px rgba(16, 185, 129, 0.2)' : 'none',
                    }}
                  />
                  <Text strong style={{ fontSize: 13, color: isMonitoringActive ? '#0f172a' : '#64748b' }}>
                    {isMonitoringActive
                      ? status?.running
                        ? '正在执行检查中...'
                        : `后台调度监控中 (${snapshot?.config?.interval_minutes || 10} 分钟/次)`
                      : '后台监控已暂停 (定时关闭)'}
                  </Text>
                </div>

                <Tooltip title="点击查看微信 ClawBot 智能体状态与指令指南">
                  <Tag
                    color={status?.clawbot?.is_online ? 'success' : (status?.clawbot?.configured ? 'warning' : 'default')}
                    style={{
                      cursor: 'pointer',
                      borderRadius: 12,
                      padding: '2px 10px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                    onClick={() => setClawbotOpen(true)}
                  >
                    <MessageCircle size={13} />
                    微信 ClawBot: {status?.clawbot?.is_online ? `在线 (${status?.clawbot?.model || 'DeepSeek'})` : (status?.clawbot?.configured ? '离线 (未启动)' : '未连接')}
                  </Tag>
                </Tooltip>

                <Text type="secondary" style={{ fontSize: 12 }}>
                  上次检查: {formatDate(status?.last_checked_at)}
                </Text>

                {isMonitoringActive && status?.next_run_at && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    下次检查: {formatDate(status?.next_run_at)}
                  </Text>
                )}
              </div>

              <Space size={8}>
                <Button
                  size="small"
                  icon={<SettingOutlined />}
                  onClick={() => setSettingsOpen(true)}
                >
                  监控配置
                </Button>
                <Button
                  size="small"
                  icon={<HistoryOutlined />}
                  onClick={() => setHistoryOpen(true)}
                >
                  检查日志
                </Button>
                <Button
                  type="primary"
                  size="small"
                  icon={<ReloadOutlined spin={runningNow} />}
                  loading={runningNow}
                  onClick={handleRunNow}
                >
                  立即刷新
                </Button>
              </Space>
            </div>

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

            {/* Medal Thresholds Banner: Ordered Gold -> Silver -> Bronze */}
            {thresholds && (
              <Card
                size="small"
                className="sim-banner-card"
                bodyStyle={{ padding: '12px 18px' }}
              >
                <Row gutter={[12, 12]} align="middle">
                  <Col xs={12} sm={6}>
                    <Statistic
                      title={<span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>天梯总参赛队伍</span>}
                      value={thresholds.total_teams}
                      suffix={<span style={{ fontSize: 12, color: '#94a3b8' }}>队</span>}
                      valueStyle={{ fontWeight: 700, fontSize: 18 }}
                    />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic
                      title={
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#ca8a04', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <TrophyOutlined style={{ fontSize: 13, color: '#ca8a04' }} /> 金牌线
                        </span>
                      }
                      value={thresholds.gold_cutoff_score ?? '—'}
                      suffix={
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                          (第 {thresholds.gold_cutoff_rank} 名)
                        </span>
                      }
                      valueStyle={{ color: '#ca8a04', fontWeight: 800, fontSize: 18 }}
                    />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic
                      title={
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <TrophyOutlined style={{ fontSize: 13, color: '#64748b' }} /> 银牌线
                        </span>
                      }
                      value={thresholds.silver_cutoff_score ?? '—'}
                      suffix={
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                          (第 {thresholds.silver_cutoff_rank} 名)
                        </span>
                      }
                      valueStyle={{ color: '#475569', fontWeight: 800, fontSize: 18 }}
                    />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic
                      title={
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <TrophyOutlined style={{ fontSize: 13, color: '#d97706' }} /> 铜牌线
                        </span>
                      }
                      value={thresholds.bronze_cutoff_score ?? '—'}
                      suffix={
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                          (第 {thresholds.bronze_cutoff_rank} 名)
                        </span>
                      }
                      valueStyle={{ color: '#d97706', fontWeight: 800, fontSize: 18 }}
                    />
                  </Col>
                </Row>
              </Card>
            )}

            {/* Dual Agent Overview Cards */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <Flame size={16} color="#f97316" />
                <Text strong style={{ fontSize: 14 }}>我方 2 个活跃提交实时战况</Text>
              </div>

              {agents.length === 0 ? (
                <Empty description="暂无代理数据，请点击右上角「立即刷新」拉取数据。" />
              ) : (
                <Row gutter={[16, 16]}>
                  {agents.map((agent, idx) => {
                    const shortName = getShortAgentName(agent, idx);
                    const medalTier = getAgentMedal(agent);
                    const isAboveBronze = medalTier === 'bronze' || medalTier === 'silver' || medalTier === 'gold';
                    const scoreVal = agent.score ?? agent.public_score;

                    return (
                      <Col xs={24} md={12} key={agent.submission_id}>
                        <Card
                          className="sim-agent-card"
                          bodyStyle={{ padding: 18 }}
                          title={
                            <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'space-between' }}>
                              <Space size={8} align="center">
                                <Tag color={idx === 0 ? 'blue' : 'purple'} style={{ margin: 0, fontWeight: 700 }}>
                                  Agent #{idx + 1}
                                </Tag>
                                <span style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                                  {shortName}
                                </span>
                                {(agent.description || agent.file_name) && (
                                  <Tooltip title={agent.description || agent.file_name}>
                                    <InfoCircleOutlined style={{ color: '#94a3b8', fontSize: 13, cursor: 'pointer' }} />
                                  </Tooltip>
                                )}
                              </Space>
                              {getMedalTag(medalTier)}
                            </div>
                          }
                        >
                          {/* Score & Rank banner - 2 Column Clean Card Layout */}
                          <Row gutter={12}>
                            <Col span={12}>
                              <div className="sim-score-box">
                                <span className="sim-score-title">当前天梯积分</span>
                                <span className="sim-score-value">
                                  {scoreVal !== undefined && scoreVal !== null ? Number(scoreVal).toFixed(1) : '—'}
                                </span>
                              </div>
                            </Col>

                            <Col span={12}>
                              <div className="sim-rank-box">
                                <span className="sim-rank-title">当前排行榜名次</span>
                                <span className="sim-rank-value">
                                  {agent.rank ? `第 ${agent.rank} 名` : '—'}
                                </span>
                              </div>
                            </Col>
                          </Row>

                          {/* Bronze Gap Cushion */}
                          {agent.bronze_gap_score !== undefined && agent.bronze_gap_score !== null && (
                            <div className={isAboveBronze ? 'sim-cushion-banner-success' : 'sim-cushion-banner-danger'}>
                              <span>
                                {isAboveBronze ? '🛡️ 铜牌安全垫 (高于铜牌线)' : '⚠️ 距离铜牌线差距'}
                              </span>
                              <span style={{ fontSize: 14, fontWeight: 800 }}>
                                {isAboveBronze ? `+${agent.bronze_gap_score.toFixed(1)} 分` : `${agent.bronze_gap_score.toFixed(1)} 分`}
                              </span>
                            </div>
                          )}

                          {/* Win Rate Progress & Stats */}
                          <div className="sim-stats-section">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontWeight: 600, fontSize: 12, color: '#334155' }}>
                                胜率 ({agent.win_rate.toFixed(1)}%)
                              </span>
                              <Space size={4}>
                                <Tag color="success" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>{agent.wins} 胜</Tag>
                                <Tag color="error" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>{agent.losses} 负</Tag>
                                {agent.ties > 0 && <Tag style={{ margin: 0, fontSize: 11 }}>{agent.ties} 平</Tag>}
                                <Text type="secondary" style={{ fontSize: 11, marginLeft: 2 }}>(共 {agent.total_episodes} 局)</Text>
                              </Space>
                            </div>
                            <Progress
                              percent={agent.win_rate}
                              strokeColor={agent.win_rate >= 50 ? '#10b981' : '#f59e0b'}
                              showInfo={false}
                              size={['100%', 6]}
                            />
                          </div>

                          {/* Card Footer Meta */}
                          <div className="sim-footer-meta">
                            <span>提交 ID: <code style={{ fontFamily: 'monospace', color: '#475569', fontWeight: 600 }}>#{agent.submission_id}</code></span>
                            <span>队伍: <strong style={{ color: '#1e293b' }}>{agent.team_name || 'GrimmsnaRL'}</strong></span>
                          </div>
                        </Card>
                      </Col>
                    );
                  })}
                </Row>
              )}
            </div>

            {/* Match Stream Section: Split into Left and Right Columns */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Swords size={16} color="#3b82f6" />
                  <Text strong style={{ fontSize: 14 }}>最新对局流水 (点击对局 ID 可观看回放)</Text>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共追踪 {status?.total_tracked_episodes || totalTrackedCount} 场对战记录
                </Text>
              </div>

              <Row gutter={[16, 16]}>
                {/* Left Column: Agent 1 Episodes */}
                <Col xs={24} lg={12}>
                  <Card
                    size="small"
                    className="sim-agent-card"
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
                        <Space size={6}>
                          <Tag color="blue" style={{ margin: 0, fontSize: 11, fontWeight: 700 }}>Agent #1</Tag>
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{agent1 ? getShortAgentName(agent1, 0) : 'Agent 1'} 对局流水</span>
                        </Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          共 {agent1?.total_episodes || agent1Episodes.length} 局 ({agent1?.wins || 0}胜 {agent1?.losses || 0}负)
                        </Text>
                      </div>
                    }
                  >
                    <Table
                      columns={sideEpisodeColumns}
                      dataSource={agent1Episodes}
                      rowKey="id"
                      size="small"
                      scroll={{ x: 380 }}
                      pagination={{ pageSize: 6, showSizeChanger: false, size: 'small' }}
                      bordered
                    />
                  </Card>
                </Col>

                {/* Right Column: Agent 2 Episodes */}
                <Col xs={24} lg={12}>
                  <Card
                    size="small"
                    className="sim-agent-card"
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
                        <Space size={6}>
                          <Tag color="purple" style={{ margin: 0, fontSize: 11, fontWeight: 700 }}>Agent #2</Tag>
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{agent2 ? getShortAgentName(agent2, 1) : 'Agent 2'} 对局流水</span>
                        </Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          共 {agent2?.total_episodes || agent2Episodes.length} 局 ({agent2?.wins || 0}胜 {agent2?.losses || 0}负)
                        </Text>
                      </div>
                    }
                  >
                    <Table
                      columns={sideEpisodeColumns}
                      dataSource={agent2Episodes}
                      rowKey="id"
                      size="small"
                      scroll={{ x: 380 }}
                      pagination={{ pageSize: 6, showSizeChanger: false, size: 'small' }}
                      bordered
                    />
                  </Card>
                </Col>
              </Row>
            </div>
          </div>
        </Spin>
      </Modal>

      {/* Settings Drawer */}
      <Drawer
        title="模拟对战监控设置"
        placement="right"
        width="min(420px, 100vw)"
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        extra={
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={() => form.submit()}
          >
            保存配置
          </Button>
        }
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSaveConfig}
          initialValues={{
            enabled: true,
            competition: 'pokemon-tcg-ai-battle',
            interval_minutes: 10,
            bronze_percentile: 0.10,
            target_submission_ids: [55565346, 55555162],
            notify_on_new_matches: true,
            notify_on_medal_change: true,
          }}
        >
          <Form.Item
            name="enabled"
            label="启用后台定时对战监控"
            valuePropName="checked"
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>

          <Form.Item
            name="competition"
            label="监控竞赛 Slug"
            rules={[{ required: true, message: '请输入竞赛 Slug' }]}
          >
            <Input placeholder="pokemon-tcg-ai-battle" />
          </Form.Item>

          <Form.Item
            name="interval_minutes"
            label="轮询检查间隔 (分钟)"
            rules={[{ required: true }]}
          >
            <InputNumber min={2} max={1440} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="bronze_percentile"
            label="铜牌线切分比例 (例如 0.10 代表前 10%)"
            rules={[{ required: true }]}
          >
            <InputNumber min={0.01} max={0.50} step={0.01} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="target_submission_ids"
            label={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span>🎯 监控的目标 Agent 提交 ID (支持团队成员提交)</span>
              </div>
            }
            tooltip="可直接勾选团队已识别的 Agent，或直接输入/粘贴团队成员提交的 8 位 Submission ID (如 55565346, 55555162)"
          >
            <Select
              mode="tags"
              placeholder={loadingSubmissions ? "正在同步可用 Agent 列表..." : "点击下拉勾选 Agent，或直接输入团队提交 ID"}
              tokenSeparators={[',', ' ']}
              loading={loadingSubmissions}
              style={{ width: '100%' }}
              options={availableSubmissions.map((sub) => {
                const desc = sub.description || sub.file_name || `提交 #${sub.submission_id}`;
                const scoreText = sub.public_score !== undefined && sub.public_score !== null ? ` · ${sub.public_score.toFixed(1)}分` : '';
                return {
                  value: sub.submission_id,
                  label: `#${sub.submission_id} · ${desc}${scoreText}`,
                };
              })}
            />
          </Form.Item>

          <div style={{ marginTop: -14, marginBottom: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button
              size="small"
              type="dashed"
              loading={loadingSubmissions}
              onClick={() => {
                if (availableSubmissions.length > 0) {
                  const latestTwo = availableSubmissions
                    .filter((s) => s.status?.toLowerCase().includes('complete') || s.status?.toLowerCase().includes('success'))
                    .slice(0, 2)
                    .map((s) => s.submission_id);
                  form.setFieldsValue({
                    target_submission_ids: latestTwo.length > 0 ? latestTwo : availableSubmissions.slice(0, 2).map((s) => s.submission_id),
                  });
                } else {
                  void fetchAvailableSubmissions().then(() => {
                    message.info('正在拉取提交列表，请再次点击');
                  });
                }
              }}
            >
              ⚡ 快捷填入最新 2 个有效提交
            </Button>
            <Button
              size="small"
              type="text"
              onClick={() => form.setFieldsValue({ target_submission_ids: [] })}
            >
              清空 (全自动模式)
            </Button>
          </div>

          <div style={{ paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
            <Form.Item
              name="notify_on_new_matches"
              label="新增对局战报时发送通知"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>

            <Form.Item
              name="notify_on_medal_change"
              label="奖牌状态升降级变动时发送通知"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </div>
        </Form>
      </Drawer>

      {/* History & Run Logs Modal */}
      <Modal
        title="模拟对战监控运行日志"
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        width={720}
        footer={null}
      >
        <List
          dataSource={snapshot?.logs || []}
          renderItem={(log) => (
            <List.Item
              key={log.id}
              actions={[
                log.details_available ? (
                  <Button
                    type="link"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => handleViewLogDetail(log.id)}
                  >
                    查看明细
                  </Button>
                ) : null,
              ]}
            >
              <List.Item.Meta
                avatar={
                  log.outcome === 'success' ? (
                     <CheckCircleOutlined style={{ color: '#10b981', fontSize: 18 }} />
                  ) : log.outcome === 'partial' ? (
                    <ExclamationCircleOutlined style={{ color: '#f59e0b', fontSize: 18 }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: '#f43f5e', fontSize: 18 }} />
                  )
                }
                title={
                  <Space>
                    <Tag>{log.trigger === 'manual' ? '手动触发' : '定时调度'}</Tag>
                    <Text strong>{formatDate(log.started_at)}</Text>
                    <Text type="secondary">耗时: {formatDuration(log.duration_seconds)}</Text>
                  </Space>
                }
                description={
                  <div>
                    <span>追踪 {log.agent_count} 个代理，抓取 {log.total_episodes_found} 场对局</span>
                    {log.new_episodes_found > 0 && (
                      <Tag color="green" style={{ marginLeft: 6 }}>
                        +{log.new_episodes_found} 场新对局
                      </Tag>
                    )}
                    {log.error && <div style={{ color: '#f43f5e', fontSize: 12, marginTop: 4 }}>{log.error}</div>}
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </Modal>

      {/* WeChat ClawBot Assistant Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageCircle size={18} color="#16a34a" />
            <span style={{ fontWeight: 700 }}>微信 ClawBot 智能对战助手</span>
          </div>
        }
        open={clawbotOpen}
        onCancel={() => setClawbotOpen(false)}
        width={560}
        footer={[
          <Button
            key="test"
            icon={<ReloadOutlined spin={testingClawbot} />}
            loading={testingClawbot}
            onClick={() => void handleTestClawbot()}
          >
            探测网关连通性
          </Button>,
          <Button key="close" type="primary" onClick={() => setClawbotOpen(false)}>
            我知道了
          </Button>,
        ]}
      >
        <div style={{ paddingTop: 8 }}>
          <Alert
            message={status?.clawbot?.is_online ? '微信智能体双向交互已就绪' : status?.clawbot?.configured ? '微信智能体已配置，但网关离线' : '微信智能体未就绪'}
            description={
              status?.clawbot?.is_online
                ? '您可以在手机微信中随时发送指令给当前机器人，直接获取最新天梯战报与排名数据，或触发后台实时刷新。'
                : status?.clawbot?.configured
                ? '已读取到 LLM 配置文件，但当前未探测到正在运行的 OpenClaw 网关（端口 18789）。若在 Docker 中运行，请确保已配置 OPENCLAW_GATEWAY_URL。'
                : '未检测到 OpenClaw 配置文件或环境变量。请在 .env.deploy 中配置 OPENCLAW_LLM_API_KEY 与 OPENCLAW_GATEWAY_URL。'
            }
            type={status?.clawbot?.is_online ? 'success' : status?.clawbot?.configured ? 'warning' : 'info'}
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Card size="small" style={{ marginBottom: 16, background: '#f8fafc' }}>
            <Row gutter={[12, 10]}>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>网关活跃状态</Text>
                <div style={{ marginTop: 2 }}>
                  {status?.clawbot?.is_online ? (
                    <Tag color="success" style={{ fontWeight: 700 }}>端口 18789 活跃</Tag>
                  ) : status?.clawbot?.configured ? (
                    <Tag color="warning">已配置 · 网关离线</Tag>
                  ) : (
                    <Tag color="default">未就绪</Tag>
                  )}
                </div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>解析大模型引擎</Text>
                <div style={{ marginTop: 2, fontWeight: 700, color: '#0f172a' }}>
                  {status?.clawbot?.model || 'deepseek-v4-flash-0731'}
                </div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>模型服务商</Text>
                <div style={{ marginTop: 2, color: '#334155' }}>
                  {status?.clawbot?.provider || 'TokenRhythm Studio'}
                </div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>当前连接网关</Text>
                <div style={{ marginTop: 2, color: '#334155', fontSize: 12, wordBreak: 'break-all' }}>
                  {status?.clawbot?.gateway_url || 'http://127.0.0.1:18789'}
                </div>
              </Col>
            </Row>

            {clawbotTestResult && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: clawbotTestResult.success ? '#166534' : '#b45309' }}>
                  诊断详情：{clawbotTestResult.message}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {clawbotTestResult.candidates.map((c) => (
                    <div key={c.target} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, background: '#fff', padding: '3px 8px', borderRadius: 4, border: '1px solid #f1f5f9' }}>
                      <Text code style={{ fontSize: 11 }}>{c.target}</Text>
                      <Tag color={c.reachable ? 'success' : 'default'} style={{ margin: 0, fontSize: 11, padding: '0 4px' }}>
                        {c.detail}
                      </Tag>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Title level={5} style={{ fontSize: 14, marginBottom: 8 }}>
            📱 手机微信常用指令速查
          </Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f1f5f9', borderRadius: 6 }}>
              <Space>
                <Tag color="blue" style={{ margin: 0, fontWeight: 700 }}>战况 / 查战况</Tag>
                <Text style={{ fontSize: 13 }}>获取双 Agent 实时积分、排位、胜率及最新一局对战</Text>
              </Space>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f1f5f9', borderRadius: 6 }}>
              <Space>
                <Tag color="gold" style={{ margin: 0, fontWeight: 700 }}>分数 / 排名</Tag>
                <Text style={{ fontSize: 13 }}>快速汇总金银铜牌线切分点与我方安全垫</Text>
              </Space>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f1f5f9', borderRadius: 6 }}>
              <Space>
                <Tag color="purple" style={{ margin: 0, fontWeight: 700 }}>刷新 / 立即检查</Tag>
                <Text style={{ fontSize: 13 }}>触发后端立刻向 Kaggle 同步一次最新对局数据</Text>
              </Space>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default SimulationMonitorControl;
