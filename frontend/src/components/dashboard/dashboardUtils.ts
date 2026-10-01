import type { SubmissionMonitorItem } from '../../types/submissions.ts';
import type { SimulationAgentStats, SimulationMonitorStatus } from '../../types/simulation.ts';

export function simulationScore(agent?: SimulationAgentStats): number | undefined {
  for (const value of [agent?.score, agent?.public_score]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function bestCompetitionAgent(status: SimulationMonitorStatus | undefined, competition: string) {
  if (!competition || status?.competition !== competition) return undefined;
  let best: SimulationAgentStats | undefined;
  const rank = (agent: SimulationAgentStats) => typeof agent.rank === 'number' && Number.isInteger(agent.rank) && agent.rank > 0 ? agent.rank : Infinity;
  for (const agent of status.agents || []) {
    const score = simulationScore(agent);
    if (score === undefined) continue;
    const bestScore = simulationScore(best);
    if (!best || bestScore === undefined || score > bestScore || (score === bestScore && rank(agent) < rank(best))) best = agent;
  }
  return best;
}

export function simulationCushion(agent?: SimulationAgentStats) {
  const labels = { gold: '金牌安全垫', silver: '银牌安全垫', bronze: '铜牌安全垫' };
  const tier = agent?.medal_tier;
  const cushion = agent?.tier_cushion_score;
  if (tier && tier in labels && typeof cushion === 'number' && Number.isFinite(cushion)) {
    return { label: labels[tier as keyof typeof labels], text: `${cushion >= 0 ? '+' : ''}${cushion.toFixed(1)} 分`, negative: cushion < 0 };
  }
  const gap = agent?.bronze_gap_score;
  if (typeof gap === 'number' && Number.isFinite(gap)) {
    return { label: gap < 0 ? '距铜牌线' : '铜牌余量', text: `${gap < 0 ? '' : '+'}${Math.abs(gap).toFixed(1)} 分`, negative: gap < 0 };
  }
  return { label: '奖牌差距', text: '等待同步', negative: false };
}

export const formatBytes = (value = 0) => {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
};

export const formatRelativeTime = (timeStr?: string | null) => {
  if (!timeStr) return '';
  try {
    const target = new Date(timeStr);
    if (Number.isNaN(target.getTime())) return '时间未知';
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - target.getTime()) / 1000);
    if (diffSec < 0) {
      const futureSec = Math.abs(diffSec);
      if (futureSec < 60) return `${futureSec} 秒后`;
      if (futureSec < 3600) return `${Math.floor(futureSec / 60)} 分钟后`;
      return `${Math.floor(futureSec / 3600)} 小时后`;
    }
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
    return `${Math.floor(diffSec / 86400)} 天前`;
  } catch {
    return timeStr;
  }
};

export function schedulerLabel(status?: { running: boolean; next_run_at?: string; enabled?: boolean; scheduler_alive: boolean; last_error?: string }) {
  if (!status) return '状态未知';
  if (status.running) return '执行中';
  if (status.last_error) return '最近执行异常';
  if (status.enabled === false) return '定时已关闭';
  if (status.next_run_at) return status.scheduler_alive ? '等待下次执行' : '调度器离线';
  return '当前未执行';
}

export function latestCompetitionSubmission(items: SubmissionMonitorItem[] | undefined, competition: string) {
  if (!competition) return undefined;
  return items?.filter(item => item.competition === competition).sort((a, b) => {
    const time = (value?: string) => { const parsed = Date.parse(value || ''); return Number.isNaN(parsed) ? 0 : parsed; };
    return time(b.date) - time(a.date);
  })[0];
}
