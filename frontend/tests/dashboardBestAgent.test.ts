import assert from 'node:assert/strict';
import test from 'node:test';
import { bestCompetitionAgent, simulationScore, simulationCushion } from '../src/components/dashboard/dashboardUtils.ts';
import type { SimulationAgentStats, SimulationMonitorStatus } from '../src/types/simulation.ts';

const agent = (id: number, score?: number, extra: Partial<SimulationAgentStats> = {}): SimulationAgentStats => ({
  submission_id: id, score, team_name: '', wins: 2, losses: 1, ties: 0,
  total_episodes: 3, system_checks: 0, win_rate: 66.7, recent_episodes: [], rating_trajectory: [], ...extra,
});
const state = (agents: SimulationAgentStats[]): SimulationMonitorStatus => ({
  competition: 'a', agents, running: false, scheduler_alive: true, total_tracked_episodes: 0,
  new_episodes_this_run: 0, history: [],
});

test('最高分卡片不受列表位置或提交时间影响，所有统计取自同一Agent', () => {
  const latest = agent(1, 2200, { date: '2026-10-01', rank: 277, wins: 22 });
  const best = agent(2, 2443.1, { date: '2026-09-20', rank: 142, alias: 'can', wins: 33, medal_tier: 'silver', tier_cushion_score: 375.4 });
  const status = state([latest, best]);
  assert.equal(bestCompetitionAgent(status, 'a'), best);
  assert.equal(bestCompetitionAgent(state([best, latest]), 'a'), best);
  assert.equal(status.agents[0], latest);
  assert.equal(simulationScore(best), 2443.1);
  assert.deepEqual(simulationCushion(best), { label: '银牌安全垫', text: '+375.4 分', negative: false });
});

test('比赛隔离与缺失/异常分数不产生虚假最高分，保留零分及public_score兼容', () => {
  const zero = agent(1, 0, { public_score: 999 });
  const bad = agent(2, NaN);
  assert.equal(simulationScore(zero), 0);
  assert.equal(bestCompetitionAgent(state([bad, agent(3, -2), zero]), 'a'), zero);
  assert.equal(bestCompetitionAgent(state([agent(2, Infinity), agent(3)]), 'a'), undefined);
  assert.equal(bestCompetitionAgent(state([zero]), 'b'), undefined);
  assert.equal(bestCompetitionAgent(state([zero]), ''), undefined);
  assert.equal(bestCompetitionAgent(undefined, 'a'), undefined);
  assert.equal(simulationScore(agent(4, undefined, { public_score: 25 })), 25);
});

test('同分时取有效更好排名，完全相同保持稳定，负差距不重复正号', () => {
  const first = agent(1, 100, { rank: 12 });
  const better = agent(2, 100, { rank: 8 });
  assert.equal(bestCompetitionAgent(state([first, agent(3, 100, { rank: 0 }), better]), 'a'), better);
  assert.equal(bestCompetitionAgent(state([first, agent(4, 100, { rank: 12 })]), 'a'), first);
  assert.deepEqual(simulationCushion(agent(1, 5, { bronze_gap_score: -4.1 })), { label: '距铜牌线', text: '4.1 分', negative: true });
});
