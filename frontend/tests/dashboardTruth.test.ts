import assert from 'node:assert/strict';
import test from 'node:test';
import { latestCompetitionSubmission, schedulerLabel, formatRelativeTime } from '../src/components/dashboard/dashboardUtils.ts';
import { selectSimulationData } from '../src/components/arena/arenaData.ts';
import type { SubmissionMonitorItem } from '../src/types/submissions.ts';
import type { SimulationMonitorStatus } from '../src/types/simulation.ts';

const item = (ref: string, competition?: string, date?: string): SubmissionMonitorItem => ({
  ref, competition, date, description: '', status: 'complete', watched: true, newly_scored: false,
});

test('首页最新提交按赛事和提交时间选取，不借用全局首项、不修改原始顺序', () => {
  const items = [item('other', 'b', '2026-10-01'), item('old', 'a', '2026-09-01'), item('new', 'a', '2026-09-30'), item('unknown', undefined, '2026-10-02')];
  assert.equal(latestCompetitionSubmission(items, 'a')?.ref, 'new');
  assert.equal(latestCompetitionSubmission(items, 'c'), undefined);
  assert.equal(latestCompetitionSubmission(items, ''), undefined);
  assert.equal(items[0].ref, 'other');
  assert.equal(items[1].ref, 'old');
});

test('提交缺失或时间无效时不串赛事，也不掩盖有效日期的提交', () => {
  assert.equal(latestCompetitionSubmission(undefined, 'a'), undefined);
  assert.equal(latestCompetitionSubmission([item('invalid', 'a', 'invalid'), item('valid', 'a', '2026-09-30')], 'a')?.ref, 'valid');
  assert.equal(formatRelativeTime('invalid'), '时间未知');
});

test('未执行不等于暂停，调度线程存活不等于任务开启', () => {
  const idle = { running: false, scheduler_alive: true };
  assert.equal(schedulerLabel(), '状态未知');
  assert.equal(schedulerLabel(idle), '当前未执行');
  assert.equal(schedulerLabel({ ...idle, next_run_at: '2026-10-02' }), '等待下次执行');
  assert.equal(schedulerLabel({ ...idle, enabled: false }), '定时已关闭');
  assert.equal(schedulerLabel({ ...idle, scheduler_alive: false, next_run_at: '2026-10-02' }), '调度器离线');
  assert.equal(schedulerLabel({ ...idle, last_error: 'failed' }), '最近执行异常');
  assert.equal(schedulerLabel({ ...idle, running: true, last_error: 'old failure' }), '执行中');
});

test('宝可梦无采集数据时不再凭赛事名称注入成绩或奖牌线', () => {
  assert.deepEqual(selectSimulationData(undefined, 'pokemon-tcg-ai-battle'), { matches: false, agents: [], thresholds: undefined });
});

test('对战成绩及奖牌线由快照赛事隔离，保留真实零分', () => {
  const status: SimulationMonitorStatus = {
    running: false, scheduler_alive: true, competition: 'a',
    agents: [{ submission_id: 1, score: 0, wins: 0, losses: 0, ties: 0, total_episodes: 0, recent_episodes: [] }],
    thresholds: { gold_cutoff_score: 0 },
    total_tracked_episodes: 0, new_episodes_this_run: 0, history: [],
  };
  assert.deepEqual(selectSimulationData(status, 'b'), { matches: false, agents: [], thresholds: undefined });
  const selected = selectSimulationData(status, 'a');
  assert.equal(selected.agents[0].score, 0);
  assert.equal(selected.thresholds?.gold_cutoff_score, 0);
});
