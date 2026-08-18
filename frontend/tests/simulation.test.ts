import assert from 'node:assert/strict';
import test from 'node:test';
import { api, type SimulationMonitorConfig, type SimulationMonitorSnapshot } from '../src/api.ts';

test('getSimulationMonitor 正确发送请求并解析快照响应', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    const mockSnapshot: SimulationMonitorSnapshot = {
      config: {
        enabled: true,
        competition: 'pokemon-tcg-ai-battle',
        target_submission_ids: [55565346, 55555162],
        interval_minutes: 10,
        bronze_percentile: 0.10,
        notify_on_new_matches: true,
        notify_on_medal_change: true,
      },
      status: {
        running: true,
        scheduler_alive: true,
        competition: 'pokemon-tcg-ai-battle',
        agents: [
          {
            submission_id: 55565346,
            team_name: 'GrimmsnaRL',
            score: 862.8,
            rank: 650,
            total_episodes: 69,
            wins: 38,
            losses: 31,
            ties: 0,
            win_rate: 55.07,
            medal_tier: 'bronze',
            bronze_gap_score: 23.8,
            recent_episodes: [],
          },
        ],
        thresholds: {
          total_teams: 6807,
          gold_cutoff_rank: 23,
          gold_cutoff_score: 1515.2,
          silver_cutoff_rank: 340,
          silver_cutoff_score: 1087.8,
          bronze_cutoff_rank: 680,
          bronze_cutoff_score: 839.0,
          bronze_percentile: 0.10,
        },
        total_tracked_episodes: 69,
        new_episodes_this_run: 0,
        history: [],
      },
      logs: [],
    };
    return new Response(JSON.stringify(mockSnapshot), {
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const res = await api.getSimulationMonitor();
    assert.equal(requestedUrl, '/api/simulation-monitor');
    assert.equal(res.status.competition, 'pokemon-tcg-ai-battle');
    assert.equal(res.status.agents.length, 1);
    assert.equal(res.status.agents[0].submission_id, 55565346);
    assert.equal(res.status.agents[0].medal_tier, 'bronze');
    assert.equal(res.status.thresholds?.total_teams, 6807);
    assert.equal(res.status.thresholds?.bronze_cutoff_score, 839.0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateSimulationMonitor 正确发送 PUT 请求', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestMethod = '';
  let requestBody = '';

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestMethod = init?.method || 'GET';
    requestBody = String(init?.body || '');
    return new Response(
      JSON.stringify({
        config: JSON.parse(requestBody),
        status: {
          running: true,
          scheduler_alive: true,
          competition: 'pokemon-tcg-ai-battle',
          agents: [],
          total_tracked_episodes: 0,
          new_episodes_this_run: 0,
          history: [],
        },
        logs: [],
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const payload: SimulationMonitorConfig = {
      enabled: false,
      competition: 'pokemon-tcg-ai-battle',
      target_submission_ids: [55565346],
      interval_minutes: 15,
      bronze_percentile: 0.10,
      notify_on_new_matches: false,
      notify_on_medal_change: true,
    };
    const res = await api.updateSimulationMonitor(payload);
    assert.equal(requestedUrl, '/api/simulation-monitor');
    assert.equal(requestMethod, 'PUT');
    assert.equal(res.config.enabled, false);
    assert.equal(res.config.interval_minutes, 15);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runSimulationMonitor 正确触发 POST /api/simulation-monitor/run', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestMethod = '';

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestMethod = init?.method || 'GET';
    return new Response(
      JSON.stringify({
        config: {
          enabled: true,
          competition: 'pokemon-tcg-ai-battle',
          target_submission_ids: [],
          interval_minutes: 10,
          bronze_percentile: 0.10,
          notify_on_new_matches: true,
          notify_on_medal_change: true,
        },
        status: {
          running: true,
          scheduler_alive: true,
          competition: 'pokemon-tcg-ai-battle',
          agents: [],
          total_tracked_episodes: 0,
          new_episodes_this_run: 0,
          history: [],
        },
        logs: [],
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const res = await api.runSimulationMonitor();
    assert.equal(requestedUrl, '/api/simulation-monitor/run');
    assert.equal(requestMethod, 'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
