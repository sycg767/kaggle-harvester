import React from 'react';
import { Button } from 'antd';
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
import { formatRelativeTime, schedulerLabel, simulationScore, simulationCushion } from './dashboardUtils';

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
  bestAgent?: SimulationAgentStats;
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
  bestAgent,
  runningSimulationCheck,
  onRunSimulationCheckNow,
  competitionInfo,
  testingNotifications,
  onTestNotifications,
  onNavigate,
}) => {
  const bestScore = simulationScore(bestAgent);
  const cushion = simulationCushion(bestAgent);
  return (
    <section className="section" style={{ marginBottom: 24 }}>
      <div className="ios-section-head">
        <div className="ios-section-title">
          <span className="ios-section-symbol">
            <Zap size={15} />
          </span>
          <span>全局自动化与当前赛事工具</span>
        </div>
        <div className="ios-section-note">巡检与查分执行已保存的全局配置，不随页面切换</div>
      </div>

      <div className="ios-control-grid">
        {/* Card 1: 自动归档 */}
        <article className="ios-control-card">
          <div className="ios-card-top">
            <div className="ios-card-title-group">
              <div className="ios-icon-tile blue">
                <Archive size={18} />
              </div>
              <div className="ios-card-name">自动归档</div>
            </div>
            <span className="ios-status-chip">{schedulerLabel(autoArchiveStatus)}</span>
          </div>

          <div className="ios-metric">
            <div className="ios-metric-label">全部赛事累计归档</div>
            <div className="ios-metric-value">
              {archiveStats?.total_archives ?? '—'}
            </div>
          </div>

          <div className="ios-detail-line">
            <span>上次巡检</span>
            <strong>{formatRelativeTime(autoArchiveStatus?.last_checked_at) || '尚未运行'}</strong>
          </div>
          <div className="ios-detail-line">
            <span>命中高分</span>
            <strong style={{ color: '#23a944' }}>
              {autoArchiveStatus?.last_checked_at && autoArchiveStatus?.matched_count != null ? `最近命中 ${autoArchiveStatus.matched_count} 个` : '尚无记录'}
            </strong>
          </div>

          <div className="ios-card-footer">
            <Button
              type="primary"
              size="small"
              icon={<Play size={11} />}
              loading={runningAutoArchive}
              onClick={onRunAutoArchiveNow}
            >
              运行全局归档规则
            </Button>
            <AutoArchiveControl currentCompetition={currentCompetition} buttonText="配置与历史" />
          </div>
        </article>

        {/* Card 2: 提交流水监控 */}
        <article className="ios-control-card">
          <div className="ios-card-top">
            <div className="ios-card-title-group">
              <div className="ios-icon-tile green">
                <Activity size={18} />
              </div>
              <div className="ios-card-name">提交流水监控</div>
            </div>
            <span className="ios-status-chip">{schedulerLabel(health?.submission_monitor)}</span>
          </div>

          <div className="ios-metric">
            <div className="ios-metric-label">当前赛事最新提交公开分</div>
            <div className={`ios-metric-value ${latestSubmission?.public_score != null ? 'green' : ''}`}>
              {latestSubmission?.public_score != null ? latestSubmission.public_score.toFixed(4) : '暂无最新分'}
            </div>
          </div>

          <div className="ios-detail-line">
            <span>全部赛事待出分</span>
            <strong style={{ color: health?.submission_monitor?.pending_count ? '#d77d00' : undefined }}>
              {health?.submission_monitor?.last_checked_at && health?.submission_monitor?.pending_count != null ? `${health.submission_monitor.pending_count} 条` : '未知'}
            </strong>
          </div>
          <div className="ios-detail-line">
            <span>上次检查</span>
            <strong>{formatRelativeTime(health?.submission_monitor?.last_checked_at) || '尚未检查'}</strong>
          </div>

          <div className="ios-card-footer">
            <Button
              type="primary"
              size="small"
              icon={<Play size={11} />}
              loading={runningSubmissionCheck}
              onClick={onRunSubmissionCheckNow}
            >
              检查全局监控赛事
            </Button>
            <SubmissionMonitorControl currentCompetition={currentCompetition} buttonText="配置与历史" />
          </div>
        </article>

        {/* Card 3: 智能体天梯对战 OR 开源 Notebooks */}
        <article className="ios-control-card">
          {isSimulation ? (
            <>
              <div className="ios-card-top">
                <div className="ios-card-title-group">
                  <div className="ios-icon-tile orange">
                    <Swords size={18} />
                  </div>
                  <div className="ios-card-name">智能体天梯对战</div>
                </div>
                <span className={`ios-status-chip ${isSimCompMatch && isSimMonitoringActive ? 'orange' : ''}`}>
                  {isSimCompMatch ? schedulerLabel(health?.simulation_monitor) : '当前赛事未配置'}
                </span>
              </div>

              <div className="ios-metric">
                <div className="ios-metric-label" title={bestAgent?.last_updated ? `数据更新于 ${new Date(bestAgent.last_updated).toLocaleString()}` : '更新时间未记录'}>已监控 Agent 最高分</div>
                <div className="ios-metric-value orange">
                  {bestScore !== undefined ? <>{bestScore.toFixed(1)} <span style={{ fontSize: 13 }}>分</span></> : (isSimCompMatch ? '暂无分数' : '待配置')}
                </div>
              </div>

              <div className="ios-detail-line">
                <span>{bestAgent?.alias || (bestAgent ? `Agent #${bestAgent.submission_id}` : 'Agent')}</span>
                <strong>{bestAgent?.rank != null && Number.isInteger(bestAgent.rank) && bestAgent.rank > 0 ? `第 ${bestAgent.rank} 名` : '排名未知'}</strong>
              </div>
              <div className="ios-detail-line">
                <span>胜率</span>
                <strong>{bestAgent?.win_rate != null && Number.isFinite(bestAgent.win_rate) ? `${bestAgent.win_rate}% (${bestAgent.wins ?? 0}胜)` : '暂无数据'}</strong>
              </div>
              <div className="ios-detail-line">
                <span>{cushion.label}</span>
                <strong style={{ color: cushion.text === '等待同步' ? undefined : cushion.negative ? '#d77d00' : '#23a944' }}>{cushion.text}</strong>
              </div>

              <div className="ios-card-footer">
                <Button
                  type="primary"
                  size="small"
                  className="ant-btn-orange"
                  icon={<Play size={11} />}
                  loading={runningSimulationCheck}
                  disabled={!isSimCompMatch}
                  onClick={onRunSimulationCheckNow}
                >
                  抓取战报
                </Button>
                <SimulationMonitorControl currentCompetition={currentCompetition} buttonText="配置与战报" />
              </div>
            </>
          ) : (
            <>
              <div className="ios-card-top">
                <div className="ios-card-title-group">
                  <div className="ios-icon-tile blue">
                    <LayoutDashboard size={18} />
                  </div>
                  <div className="ios-card-name">开源 Notebooks</div>
                </div>
                <span className="ios-status-chip blue">开源高分</span>
              </div>

              <div className="ios-metric">
                <div className="ios-metric-label">已发现代码</div>
                <div className="ios-metric-value">
                  {competitionInfo?.kernel_count ?? '未知'} <span style={{ fontSize: 13, fontWeight: 500 }}>篇</span>
                </div>
              </div>

              <div className="ios-detail-line">
                <span>榜单状态</span>
                <strong style={{ color: 'var(--ios-blue)' }}>请在代码页查看分数覆盖</strong>
              </div>
              <div className="ios-detail-line">
                <span>快速检索</span>
                <strong>支持批量归档</strong>
              </div>

              <div className="ios-card-footer">
                <Button
                  type="primary"
                  size="small"
                  icon={<LayoutDashboard size={11} />}
                  onClick={() => onNavigate('/kernels')}
                >
                  发现代码
                </Button>
                <Button
                  size="small"
                  icon={<Archive size={11} />}
                  onClick={() => onNavigate('/archives')}
                >
                  全局归档 ({archiveStats?.total_archives ?? '—'})
                </Button>
              </div>
            </>
          )}
        </article>

        {/* Card 4: 多通道通知中心 */}
        <article className="ios-control-card">
          <div className="ios-card-top">
            <div className="ios-card-title-group">
              <div className="ios-icon-tile red">
                <Bell size={18} />
              </div>
              <div className="ios-card-name">通知服务中心</div>
            </div>
            {health?.notifications?.worker_alive ? (
              <span className="ios-status-chip green">● 投递线程运行</span>
            ) : (
              <span className="ios-status-chip">{health?.notifications ? '投递线程未运行' : '状态未知'}</span>
            )}
          </div>

          <div className="ios-metric">
            <div className="ios-metric-label">待发送队列</div>
            <div className="ios-metric-value">
              {health?.notifications?.pending_count ?? '—'}
            </div>
          </div>

          <div className="ios-detail-line">
            <span>上次投递</span>
            <strong>{formatRelativeTime(health?.notifications?.last_sent_at) || '无近期投递'}</strong>
          </div>
          <div className="ios-detail-line">
            <span>服务状态</span>
            <strong style={{ color: health?.notifications?.last_error ? '#ff3b30' : '#23a944' }}>
              {!health?.notifications ? '状态未知' : health.notifications.last_error ? '最近投递异常' : health.notifications.last_sent_at ? '有成功投递记录' : '尚无成功投递记录'}
            </strong>
          </div>

          <div className="ios-card-footer">
            <Button
              size="small"
              icon={<Send size={11} />}
              loading={testingNotifications}
              onClick={onTestNotifications}
            >
              测试发送
            </Button>
            <NotificationCenter buttonText="通道配置" />
          </div>
        </article>
      </div>
    </section>
  );
};

export default SchedulerCards;
