import http from 'node:http';

const port = Number(process.env.MOCK_API_PORT || 18000);

const json = (response, body, headers = {}) => {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
};

http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (url.pathname === '/api/health') {
    json(response, {
      status: 'ok', service: 'kaggle-harvester', version: 'test', ready: true,
      kaggle_cli: true, token_configured: true, utf8_wrapper: '', utf8_wrapper_exists: true,
      default_competition: 'example-competition',
      archive: { total_archives: 0, unique_competitions: 0, unique_kernels: 0, harvest_root: '', total_size_bytes: 0 },
      cache: {},
      auto_archive: { running: false, scheduler_alive: true, checked_count: 0, matched_count: 0, archived_count: 0, skipped_count: 0, failed_count: 0, recent_results: [] },
    });
    return;
  }
  if (url.pathname === '/api/competition') {
    json(response, { id: 'example-competition', title: '示例竞赛', category: 'featured', is_lower_better: true, score_direction_source: 'leaderboard' });
    return;
  }
  if (url.pathname === '/api/kernels') {
    json(response, [{
      ref: 'owner/example-notebook', title: '示例 Notebook', author: 'owner', public_score: 6.939,
      public_score_display: '6.9390', vote_count: 3, total_votes: 3, is_competition_kernel: true,
      kernel_type: 'notebook', category: '', last_run_time: '2026-07-19T00:00:00Z', competition: 'example-competition',
    }], { 'X-Kernel-Cache': 'HIT', 'X-Kernel-Cache-Age': '10', 'X-Kernel-Refresh': 'idle' });
    return;
  }
  if (url.pathname === '/api/archives') {
    json(response, []);
    return;
  }
  if (url.pathname === '/api/archives/stats') {
    json(response, { total_archives: 0, unique_competitions: 0, unique_kernels: 0, harvest_root: '', total_size_bytes: 0 });
    return;
  }
  if (url.pathname === '/api/auto-archive') {
    json(response, {
      config: { enabled: false, competition: 'example-competition', interval_minutes: 2, include_outputs: true, score_direction: 'auto' },
      status: { running: false, scheduler_alive: true, checked_count: 0, matched_count: 0, archived_count: 0, skipped_count: 0, failed_count: 0, recent_results: [] },
      logs: [],
    });
    return;
  }
  if (url.pathname === '/api/notifications') {
    json(response, {
      config: {
        notify_on_archive: true, notify_on_failure: true,
        webhook_enabled: false, webhook_format: 'generic',
        email_enabled: false, smtp_host: '', smtp_port: 587,
        smtp_security: 'starttls', smtp_username: '', smtp_from: '', smtp_to: [],
        webhook_configured: false, smtp_password_configured: false,
        secret_storage: 'windows_dpapi',
      },
      status: { worker_alive: true, pending_count: 0 },
    });
    return;
  }
  response.writeHead(404);
  response.end('Not found');
}).listen(port, '127.0.0.1');
