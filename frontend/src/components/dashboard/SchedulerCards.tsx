import React from 'react';
import { Button, Card, Col, Row, Space, Tag } from 'antd';
import {
  Activity,
  Archive,
  Bell,
  LayoutDashboard,
  Play,
  Send,
  Swords,
  Zap,
} from 'lucide-react';
import type {
  ArchiveStats,
  CompetitionInfo,
  HealthStatus,
  SimulationAgentStats,
  SubmissionMonitorItem,
} from '../../api';
import NotificationCenter from '../NotificationCenter';
import SubmissionMonitorControl from '../SubmissionMonitorControl';
import SimulationMonitorControl from '../SimulationMonitorControl';
import AutoArchiveControl from '../AutoArchiveControl';
import { formatRelativeTime } from './dashboardUtils';

interface SchedulerCardsProps {
  currentCompetition: string;
  archiveStats: ArchiveStats | null;
  autoArchiveStatus?: HealthStatus['auto_archive'];
  runningAutoArchive: boolean;
  onRunAutoArchiveNow: () => Promise<void>;
  health: HealthStatus | null;
  latestSubmission?: SubmissionMonitorItem;
  runningSubmissionCheck: boolean;
  onRunSubmissionCheckNow: () => Promise<void>;
  isSimulation: boolean;
  isSimCompMatch: boolean;
  isSimMonitoringActive: boolean;
  activeAgent1?: SimulationAgentStats;
  runningSimulationCheck: boolean;
  onRunSimulationCheckNow: () => Promise<void>;
  competitionInfo: CompetitionInfo | null;
  testingNotifications: boolean;
  onTestNotifications: () => Promise<void>;
  onNavigate: (path: string) => void;
}

export const SchedulerCards: React.FC<SchedulerCardsProps> = ({
  currentCompetition,
  archiveStats,
  autoArchiveStatus,
  runningAutoArchive,
  onRunAutoArchiveNow,
  health,
  latestSubmission,
  runningSubmissionCheck,
  onRunSubmissionCheckNow,
  isSimulation,
  isSimCompMatch,
  isSimMonitoringActive,
  activeAgent1,
  runningSimulationCheck,
  onRunSimulationCheckNow,
  competitionInfo,
  testingNotifications,
  onTestNotifications,
  onNavigate,
}) => {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Space align="center" size={8}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: '#e0f2fe', display: 'grid', placeItems: 'center' }}>
            <Zap size={16} color="#0284c7" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
            实时监控与自动化调度中枢
          </span>
          <Tag color="processing" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>
            实时态势 · 一键直达
          </Tag>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        {/* Card 1: 智能自动归档 */}
        <Col xs={24} sm={12} xl={6}>
          <Card
            className="dashboard-glow-card"
            style={{
              height: '100%',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
            styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%' } }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: '#eff6ff', display: 'grid', placeItems: 'center' }}>
                  <Archive size={18} color="#1677ff" />
                </div>
                <Tag color={autoArchiveStatus?.running ? 'success' : 'default'} style={{ margin: 0, fontWeight: 500, borderRadius: 4 }}>
                  {autoArchiveStatus?.running ? '● 运行中' : '○ 已暂停'}
                </Tag>
              </div>

              <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                智能自动归档
              </div>

              {/* Live Metrics Box */}
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>累计已归档:</span>
                  <strong style={{ fontSize: 16, color: '#0f172a' }}>
                    {archiveStats?.total_archives ?? 0} <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>版本</span>
                  </strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                  <span>上次巡检:</span>
                  <span>{formatRelativeTime(autoArchiveStatus?.last_checked_at) || '尚未运行'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#64748b' }}>
                  <span>命中高分:</span>
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>
                    {autoArchiveStatus?.matched_count ? `命中 ${autoArchiveStatus.matched_count} 个` : '0 个新版本'}
                  </span>
                </div>
              </div>
            </div>

            {/* Dual Action Controls */}
            <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Button
                size="small"
                type="primary"
                icon={<Play size={12} />}
                loading={runningAutoArchive}
                onClick={onRunAutoArchiveNow}
                style={{ borderRadius: 6, fontSize: 12, fontWeight: 500 }}
              >
                立即巡检
              </Button>
              <AutoArchiveControl currentCompetition={currentCompetition} buttonText="配置与历史" />
            </div>
          </Card>
        </Col>

        {/* Card 2: 提交流水监控 */}
        <Col xs={24} sm={12} xl={6}>
          <Card
            className="dashboard-glow-card"
            style={{
              height: '100%',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
            styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%' } }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: '#f0fdf4', display: 'grid', placeItems: 'center' }}>
                  <Activity size={18} color="#16a34a" />
                </div>
                <Tag color={health?.submission_monitor?.running ? 'success' : 'default'} style={{ margin: 0, fontWeight: 500, borderRadius: 4 }}>
                  {health?.submission_monitor?.running ? '● 巡检中' : '○ 待命'}
                </Tag>
              </div>

              <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                提交流水监控
              </div>

              {/* Live Metrics Box */}
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>最新出分:</span>
                  <strong style={{ fontSize: 16, color: '#0f172a' }}>
                    {latestSubmission?.public_score != null ? (
                      <span style={{ color: '#16a34a' }}>{latestSubmission.public_score.toFixed(4)}</span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>暂无最新分</span>
                    )}
                  </strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                  <span>待出分队列:</span>
                  <span style={{ color: health?.submission_monitor?.pending_count ? '#d97706' : '#64748b', fontWeight: 600 }}>
                    {health?.submission_monitor?.pending_count || 0} 条队列中
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#64748b' }}>
                  <span>上次检查:</span>
                  <span>{formatRelativeTime(health?.submission_monitor?.last_checked_at) || '尚未检查'}</span>
                </div>
              </div>
            </div>

            {/* Dual Action Controls */}
            <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Button
                size="small"
                type="primary"
                icon={<Play size={12} />}
                loading={runningSubmissionCheck}
                onClick={onRunSubmissionCheckNow}
                style={{ borderRadius: 6, fontSize: 12, fontWeight: 500 }}
              >
                立即查分
              </Button>
              <SubmissionMonitorControl currentCompetition={currentCompetition} buttonText="配置与历史" />
            </div>
          </Card>
        </Col>

        {/* Card 3: 模拟对战监控 OR 开源广场 */}
        <Col xs={24} sm={12} xl={6}>
          {isSimulation ? (
            <Card
              className="dashboard-glow-card"
              style={{
                height: '100%',
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                background: '#ffffff',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
              styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%' } }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: '#fffbeb', display: 'grid', placeItems: 'center' }}>
                    <Swords size={18} color="#d97706" />
                  </div>
                  <Tag
                    color={isSimCompMatch && isSimMonitoringActive ? 'gold' : 'default'}
                    style={{ margin: 0, fontWeight: 500, borderRadius: 4 }}
                  >
                    {isSimCompMatch && isSimMonitoringActive ? '天梯对抗 (监控中)' : '天梯对抗 (待命)'}
                  </Tag>
                </div>

                <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                  智能体天梯对战
                </div>

                {/* Live Metrics Box */}
                <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  {isSimCompMatch && activeAgent1 ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: '#64748b' }}>天梯当前排位:</span>
                        <strong style={{ fontSize: 16, color: '#d97706' }}>
                          {activeAgent1.rank ? `Rank #${activeAgent1.rank}` : 'Rank #—'}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                        <span>主 Agent 胜率:</span>
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>
                          {activeAgent1.win_rate != null ? `${activeAgent1.win_rate}%` : '—'}
                          {activeAgent1.wins != null ? ` (${activeAgent1.wins}胜)` : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#64748b' }}>
                        <span>铜牌安全垫:</span>
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>
                          {activeAgent1.bronze_gap_score != null ? `+${activeAgent1.bronze_gap_score.toFixed(1)} 分` : '—'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '6px 0' }}>
                      <div style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>
                        {isSimCompMatch ? '暂无追踪的智能体数据' : '后台未开启此赛事的实时监控'}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                        点击下方「配置与战报」可开启巡检
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Dual Action Controls */}
              <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Button
                  size="small"
                  type="primary"
                  icon={<Play size={12} />}
                  loading={runningSimulationCheck}
                  onClick={onRunSimulationCheckNow}
                  style={{ borderRadius: 6, fontSize: 12, fontWeight: 500, background: '#d97706', borderColor: '#d97706' }}
                >
                  抓取新战报
                </Button>
                <SimulationMonitorControl currentCompetition={currentCompetition} buttonText="配置与战报" />
              </div>
            </Card>
          ) : (
            <Card
              className="dashboard-glow-card"
              style={{
                height: '100%',
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                background: '#ffffff',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
              styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%' } }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: '#eff6ff', display: 'grid', placeItems: 'center' }}>
                    <LayoutDashboard size={18} color="#1677ff" />
                  </div>
                  <Tag color="blue" style={{ margin: 0, borderRadius: 4 }}>开源高分</Tag>
                </div>

                <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                  开源 Notebooks
                </div>

                <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>已发现代码:</span>
                    <strong style={{ fontSize: 16, color: '#0f172a' }}>
                      {competitionInfo?.kernel_count ?? '100+'} <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>篇</span>
                    </strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                    <span>榜单状态:</span>
                    <span style={{ color: '#1677ff', fontWeight: 600 }}>就绪可按分排序</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#64748b' }}>
                    <span>快速检索:</span>
                    <span style={{ color: '#64748b' }}>支持批量归档</span>
                  </div>
                </div>
              </div>

              <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Button
                  type="primary"
                  size="small"
                  icon={<LayoutDashboard size={12} />}
                  onClick={() => onNavigate('/kernels')}
                  style={{ borderRadius: 6, fontWeight: 500 }}
                >
                  进入广场
                </Button>
                <Button
                  size="small"
                  icon={<Archive size={12} />}
                  onClick={() => onNavigate('/archives')}
                  style={{ borderRadius: 6, fontWeight: 500 }}
                >
                  已归档 ({archiveStats?.total_archives ?? 0})
                </Button>
              </div>
            </Card>
          )}
        </Col>

        {/* Card 4: 多通道通知中心 */}
        <Col xs={24} sm={12} xl={6}>
          <Card
            className="dashboard-glow-card"
            style={{
              height: '100%',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
            styles={{ body: { padding: '16px 18px', display: 'flex', flexDirection: 'column', height: '100%' } }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: '#fef2f2', display: 'grid', placeItems: 'center' }}>
                  <Bell size={18} color="#ef4444" />
                </div>
                <Tag color={health?.notifications?.worker_alive ? 'success' : 'default'} style={{ margin: 0, fontWeight: 500, borderRadius: 4 }}>
                  {health?.notifications?.worker_alive ? '● 通道正常' : '○ 待命中'}
                </Tag>
              </div>

              <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 8 }}>
                通知服务中心
              </div>

              {/* Live Metrics Box */}
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>待发送队列:</span>
                  <strong style={{ fontSize: 16, color: '#0f172a' }}>
                    {health?.notifications?.pending_count || 0} <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>条</span>
                  </strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                  <span>上次投递:</span>
                  <span>{formatRelativeTime(health?.notifications?.last_sent_at) || '无近期投递'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, fontSize: 12, color: '#64748b' }}>
                  <span>服务状态:</span>
                  <span style={{ color: health?.notifications?.last_error ? '#ef4444' : '#16a34a', fontWeight: 600 }}>
                    {health?.notifications?.last_error ? '异常报警' : '就绪待发'}
                  </span>
                </div>
              </div>
            </div>

            {/* Dual Action Controls */}
            <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Button
                size="small"
                icon={<Send size={12} />}
                loading={testingNotifications}
                onClick={onTestNotifications}
                style={{ borderRadius: 6, fontSize: 12 }}
              >
                测试发送
              </Button>
              <NotificationCenter buttonText="通道配置" />
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default SchedulerCards;
