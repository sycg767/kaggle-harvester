/** API types matching the backend models. */

export interface CompetitionInfo {
  id: string;
  title: string;
  category: string;
  deadline?: string;
  reward?: string;
  team_count?: number;
  kernel_count?: number;
  evaluation_metric?: string;
  description?: string;
  is_lower_better: boolean;
  score_direction_source: 'api' | 'leaderboard' | 'metric' | 'fallback';
}

export interface ScoredKernel {
  ref: string;
  title: string;
  author: string;
  public_score?: number;
  public_score_display?: string;
  vote_count: number;
  total_votes: number;
  is_competition_kernel: boolean;
  kernel_type: string;
  category: string;
  last_run_time?: string;
  competition?: string;
}

export interface VersionInfo {
  version_number: number;
  title: string;
  status: string;
  date_created: string;
  public_lb?: string;
  public_lb_numeric?: number;
  script_version_id?: number;
}

export interface VersionScoreList {
  owner_slug: string;
  kernel_slug: string;
  versions: VersionInfo[];
}

export interface ArchiveEntry {
  id: string;
  ref: string;
  title: string;
  author: string;
  archived_at: string;
  path: string;
  version_number: number;
  public_score?: number;
  competition?: string;
  source_file?: string;
  file_count: number;
  size_bytes: number;
  include_outputs: boolean;
}

export interface ArchiveResult {
  owner_slug: string;
  kernel_slug: string;
  selected_version: number;
  script_version_id: number;
  source_path: string;
  metadata: Record<string, unknown>;
  public_score?: number;
  versions: VersionInfo[];
  already_existed: boolean;
}

export interface ArchiveStats {
  total_archives: number;
  unique_competitions: number;
  unique_kernels: number;
  harvest_root: string;
  total_size_bytes: number;
  disk_free_bytes: number;
  disk_total_bytes: number;
  disk_used_percent: number;
  min_free_bytes: number;
  low_disk_space: boolean;
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  ready: boolean;
  kaggle_cli: boolean;
  token_configured: boolean;
  utf8_wrapper: string;
  utf8_wrapper_exists: boolean;
  default_competition: string;
  archive: ArchiveStats;
  cache: Record<string, string | number>;
  auto_archive: AutoArchiveStatus;
  submission_monitor?: SubmissionMonitorStatus;
  simulation_monitor?: SimulationMonitorStatus;
  notifications?: NotificationStatus;
}

export interface KernelCacheInfo {
  state: 'HIT' | 'MISS' | 'REFRESH' | 'UPDATE' | 'STALE';
  age_seconds: number;
  fetched_at?: number;
  refresh_state: 'idle' | 'scheduled' | 'running' | 'failed';
  refreshing: boolean;
}

export interface KernelListResult {
  items: ScoredKernel[];
  cache: KernelCacheInfo;
}

export interface ArchiveFile {
  name: string;
  size_bytes: number;
  type: string;
}

export interface EnteredCompetition {
  id: string;
  title: string;
  category?: string;
  deadline?: string;
  reward?: string;
  team_count?: number;
}

export interface AutoArchiveConfig {
  enabled: boolean;
  competitions: string[];
  score_thresholds: Record<string, number>;
  interval_minutes: number;
  include_outputs: boolean;
  score_direction: 'auto' | 'minimize' | 'maximize';
}

export interface AutoArchiveItemResult {
  competition?: string;
  ref: string;
  public_score: number;
  status: 'archived' | 'skipped' | 'failed';
  version_number?: number;
  error?: string;
}

export interface AutoArchiveStatus {
  running: boolean;
  scheduler_alive: boolean;
  service_started_at?: string;
  scheduler_heartbeat_at?: string;
  last_checked_at?: string;
  next_run_at?: string;
  last_error?: string;
  checked_count: number;
  matched_count: number;
  archived_count: number;
  skipped_count: number;
  failed_count: number;
  competitions_checked?: string[];
  effective_score_direction?: 'minimize' | 'maximize';
  score_direction_source?: string;
  recent_results: AutoArchiveItemResult[];
}

export interface AutoArchiveRunLog {
  id: string;
  trigger: 'scheduled' | 'manual';
  outcome: 'success' | 'partial' | 'failed';
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  checked_count: number;
  matched_count: number;
  archived_count: number;
  skipped_count: number;
  failed_count: number;
  competitions_checked?: string[];
  error?: string;
  details_available: boolean;
}

export interface AutoArchiveCheckedItem {
  competition?: string;
  ref: string;
  title: string;
  author: string;
  public_score?: number;
  last_run_time?: string;
  matched: boolean;
  action: 'not_matched' | 'archived' | 'skipped' | 'failed';
  version_number?: number;
  error?: string;
}

export interface AutoArchiveRunDetail {
  log: AutoArchiveRunLog;
  items: AutoArchiveCheckedItem[];
}

export interface AutoArchiveSnapshot {
  config: AutoArchiveConfig;
  status: AutoArchiveStatus;
  logs: AutoArchiveRunLog[];
}

export type WebhookFormat = 'generic' | 'slack' | 'feishu' | 'dingtalk' | 'wecom' | 'ntfy';
export type SmtpSecurity = 'starttls' | 'ssl' | 'none';

export interface NotificationConfig {
  notify_on_archive: boolean;
  notify_on_failure: boolean;
  notify_on_score: boolean;
  webhook_enabled: boolean;
  webhook_format: WebhookFormat;
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_security: SmtpSecurity;
  smtp_username: string;
  smtp_from: string;
  smtp_to: string[];
  webhook_configured: boolean;
  smtp_password_configured: boolean;
  secret_storage: 'windows_dpapi' | 'environment' | 'file' | 'session';
}

export interface NotificationConfigUpdate {
  notify_on_archive?: boolean;
  notify_on_failure?: boolean;
  notify_on_score?: boolean;
  webhook_enabled?: boolean;
  webhook_format?: WebhookFormat;
  email_enabled?: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_security?: SmtpSecurity;
  smtp_username?: string;
  smtp_from?: string;
  smtp_to?: string[];
  webhook_url?: string;
  smtp_password?: string;
  clear_webhook_url?: boolean;
  clear_smtp_password?: boolean;
}

export interface SubmissionMonitorConfig {
  enabled: boolean;
  competitions: string[];
  interval_minutes: number;
  page_size: number;
  description_prefix: string;
}

export interface SubmissionScoreEvent {
  competition?: string;
  ref: string;
  description: string;
  public_score: number;
  public_score_display: string;
  status: string;
  date?: string;
  scored_at?: string;
  submitted_by?: string;
  submitted_by_ref?: string;
  team_name?: string;
  previous_public_score?: number;
}

export interface SubmissionMonitorItem {
  competition?: string;
  ref: string;
  description: string;
  status: string;
  error_description?: string;
  submitted_by?: string;
  submitted_by_ref?: string;
  team_name?: string;
  public_score?: number;
  public_score_display?: string;
  date?: string;
  scored_at?: string;
  state?: 'pending' | 'scored' | 'failed';
  watched: boolean;
  newly_scored: boolean;
}

export interface SubmissionMonitorStatus {
  running: boolean;
  scheduler_alive: boolean;
  service_started_at?: string;
  scheduler_heartbeat_at?: string;
  last_checked_at?: string;
  next_run_at?: string;
  last_error?: string;
  checked_count: number;
  pending_count: number;
  scored_count: number;
  failed_count: number;
  newly_scored_count: number;
  competitions_checked?: string[];
  recent_events: SubmissionScoreEvent[];
  recent_items: SubmissionMonitorItem[];
}

export interface SubmissionMonitorRunLog {
  id: string;
  trigger: 'scheduled' | 'manual';
  outcome: 'success' | 'partial' | 'failed';
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  checked_count: number;
  pending_count: number;
  scored_count: number;
  failed_count: number;
  newly_scored_count: number;
  competitions_checked?: string[];
  error?: string;
  details_available?: boolean;
}

export interface SubmissionMonitorRunDetail {
  log: SubmissionMonitorRunLog;
  items: SubmissionMonitorItem[];
}

export interface SubmissionMonitorSnapshot {
  config: SubmissionMonitorConfig;
  status: SubmissionMonitorStatus;
  logs: SubmissionMonitorRunLog[];
}

export interface SimulationEpisodeAgent {
  submission_id?: number;
  team_id?: number;
  team_name?: string;
  reward?: number;
  index: number;
  state?: string;
}

export interface SimulationEpisode {
  id: number;
  create_time?: string;
  end_time?: string;
  duration_seconds?: number;
  state: string;
  type?: string;
  agents: SimulationEpisodeAgent[];
  my_agent_index: number;
  my_submission_id: number;
  my_team_name: string;
  opponent_team_name: string;
  opponent_team_id?: number;
  opponent_submission_id?: number;
  result: 'win' | 'loss' | 'tie' | 'unknown';
  reward?: number;
  score_delta?: number;
  opponent_score?: number;
  replay_url?: string;
}

export interface SimulationAgentStats {
  submission_id: number;
  team_name: string;
  description?: string;
  file_name?: string;
  date?: string;
  date_submitted?: string;
  status?: string;
  public_score?: number;
  score?: number;
  public_score_display?: string;
  rank?: number;
  total_episodes: number;
  wins: number;
  losses: number;
  ties: number;
  win_rate: number;
  medal_tier?: 'gold' | 'silver' | 'bronze' | 'none' | 'unknown';
  bronze_gap_score?: number;
  bronze_gap_rank?: number;
  recent_episodes: SimulationEpisode[];
  last_updated?: string;
}

export interface SimulationMedalThresholds {
  total_teams: number;
  gold_cutoff_rank?: number;
  gold_cutoff_score?: number;
  silver_cutoff_rank?: number;
  silver_cutoff_score?: number;
  bronze_cutoff_rank?: number;
  bronze_cutoff_score?: number;
  bronze_percentile: number;
  updated_at?: string;
}

export interface SimulationHistoryPoint {
  timestamp: string;
  submission_id: number;
  score?: number;
  rank?: number;
  wins: number;
  losses: number;
  ties: number;
  win_rate: number;
  total_episodes: number;
  bronze_gap_score?: number;
}

export interface SimulationMonitorConfig {
  enabled: boolean;
  competition: string;
  target_submission_ids?: number[];
  submission_ids?: number[];
  interval_minutes: number;
  bronze_percentile: number;
  notify_on_new_matches?: boolean;
  notify_on_new_episodes?: boolean;
  notify_on_medal_change: boolean;
}

export interface SimulationMonitorStatus {
  running: boolean;
  scheduler_alive: boolean;
  service_started_at?: string;
  scheduler_heartbeat_at?: string;
  last_checked_at?: string;
  next_run_at?: string;
  last_error?: string;
  competition: string;
  agents: SimulationAgentStats[];
  thresholds?: SimulationMedalThresholds;
  medal_thresholds?: SimulationMedalThresholds;
  total_tracked_episodes: number;
  new_episodes_this_run: number;
  history: SimulationHistoryPoint[];
}

export interface SimulationMonitorRunLog {
  id: string;
  trigger: 'scheduled' | 'manual';
  outcome: 'success' | 'partial' | 'failed';
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  agent_count: number;
  total_episodes_found: number;
  new_episodes_found: number;
  error?: string;
  details_available: boolean;
}

export interface SimulationMonitorRunDetail {
  log: SimulationMonitorRunLog;
  agents: SimulationAgentStats[];
  thresholds?: SimulationMedalThresholds;
}

export interface SimulationMonitorSnapshot {
  config: SimulationMonitorConfig;
  status: SimulationMonitorStatus;
  logs: SimulationMonitorRunLog[];
}

export interface NotificationStatus {
  worker_alive: boolean;
  last_sent_at?: string;
  last_error?: string;
  last_event_id?: string;
  pending_count: number;
}

export interface NotificationSnapshot {
  config: NotificationConfig;
  status: NotificationStatus;
}

export interface NotificationChannelResult {
  channel: string;
  success: boolean;
  message: string;
}

export interface NotificationTestResult {
  success: boolean;
  channels: NotificationChannelResult[];
}

// ---------------------------------------------------------------------------
//  API client
// ---------------------------------------------------------------------------

const BASE = '/api';
const API_KEY_STORAGE = 'harvester.apiKey';

export const apiAuth = {
  getKey: () => {
    const sessionKey = typeof sessionStorage === 'undefined'
      ? ''
      : sessionStorage.getItem(API_KEY_STORAGE) || '';
    if (sessionKey) return sessionKey;
    return typeof localStorage === 'undefined'
      ? ''
      : localStorage.getItem(API_KEY_STORAGE) || '';
  },
  setKey: (value: string, remember = false) => {
    const key = value.trim();
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(API_KEY_STORAGE);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(API_KEY_STORAGE);
    if (!key) return;
    const storage = remember
      ? typeof localStorage === 'undefined' ? null : localStorage
      : typeof sessionStorage === 'undefined' ? null : sessionStorage;
    storage?.setItem(API_KEY_STORAGE, key);
  },
  clearKey: () => {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(API_KEY_STORAGE);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(API_KEY_STORAGE);
  },
};

function authHeaders(): Record<string, string> {
  const key = apiAuth.getKey();
  return key ? { 'X-Harvester-Key': key } : {};
}

async function parseResponse<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const body = await resp.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === 'string') detail = parsed.detail;
    } catch {
      // 非 JSON 错误响应保留原文。
    }
    if (resp.status === 401 && resp.headers.get('X-Harvester-Auth') === 'required') {
      apiAuth.clearKey();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('harvester:auth-required'));
      }
    }
    const fallback = resp.status >= 500 ? '服务暂时不可用，请稍后重试。' : '请求未完成。';
    throw new Error((detail || fallback).slice(0, 500));
  }
  return resp.json();
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...options?.headers },
    ...options,
  });
  return parseResponse<T>(resp);
}

export const api = {
  // Competition
  getCompetition(competition?: string, options?: { refresh?: boolean; signal?: AbortSignal }): Promise<CompetitionInfo> {
    const q = new URLSearchParams();
    if (competition) q.set('competition', competition);
    if (options?.refresh) q.set('refresh', 'true');
    const qs = q.toString();
    return request(`/competition${qs ? `?${qs}` : ''}`, { signal: options?.signal });
  },

  listEnteredCompetitions(
    pageSize = 100,
    options?: { refresh?: boolean; signal?: AbortSignal },
  ): Promise<EnteredCompetition[]> {
    const q = new URLSearchParams();
    q.set('page_size', String(pageSize));
    if (options?.refresh) q.set('refresh', 'true');
    return request(`/competitions/entered?${q.toString()}`, { signal: options?.signal });
  },

  // Kernels
  listKernels(params?: {
    sort_by?: string;
    page_size?: number;
    max_pages?: number;
    competition?: string;
    include_scores?: boolean;
    score_limit?: number;
    refresh?: boolean;
    signal?: AbortSignal;
  }): Promise<KernelListResult> {
    const q = new URLSearchParams();
    if (params?.sort_by) q.set('sort_by', params.sort_by);
    if (params?.page_size) q.set('page_size', String(params.page_size));
    if (params?.max_pages) q.set('max_pages', String(params.max_pages));
    if (params?.competition) q.set('competition', params.competition);
    if (params?.include_scores) q.set('include_scores', 'true');
    if (params?.score_limit) q.set('score_limit', String(params.score_limit));
    if (params?.refresh) q.set('refresh', 'true');
    const qs = q.toString();
    return fetch(`${BASE}/kernels${qs ? `?${qs}` : ''}`, {
      signal: params?.signal,
      headers: authHeaders(),
    }).then(async (response) => {
      const refreshState = (response.headers.get('X-Kernel-Refresh') || 'idle') as KernelCacheInfo['refresh_state'];
      return {
        items: await parseResponse<ScoredKernel[]>(response),
        cache: {
          state: (response.headers.get('X-Kernel-Cache') || 'MISS') as KernelCacheInfo['state'],
          age_seconds: Number(response.headers.get('X-Kernel-Cache-Age') || 0),
          fetched_at: response.headers.get('X-Kernel-Cache-Fetched-At')
            ? Number(response.headers.get('X-Kernel-Cache-Fetched-At'))
            : undefined,
          refresh_state: refreshState,
          refreshing: refreshState === 'scheduled' || refreshState === 'running',
        },
      };
    });
  },

  enrichKernels(refs: string[], competition?: string): Promise<ScoredKernel[]> {
    return request('/kernels/enrich', {
      method: 'POST',
      body: JSON.stringify({ kernels: refs, competition }),
    });
  },

  getKernelVersions(owner: string, slug: string, refresh = false): Promise<VersionScoreList> {
    const query = refresh ? '?refresh=true' : '';
    return request(`/kernel/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/versions${query}`);
  },

  // Archive
  archiveKernel(params: {
    kernel_ref: string;
    version?: number;
    score_direction?: string;
    include_outputs?: boolean;
    competition?: string;
    overwrite?: boolean;
  }): Promise<ArchiveResult> {
    return request('/archive', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  listArchives(competition?: string, signal?: AbortSignal): Promise<ArchiveEntry[]> {
    const q = competition ? `?competition=${encodeURIComponent(competition)}` : '';
    return request(`/archives${q}`, { signal });
  },

  getArchive(archiveId: string): Promise<ArchiveEntry> {
    return request(`/archives/${encodeURIComponent(archiveId)}`);
  },

  deleteArchive(archiveId: string): Promise<{ status: string; archive_id: string }> {
    return request(`/archives/${encodeURIComponent(archiveId)}`, {
      method: 'DELETE',
    });
  },

  getArchiveSource(archiveId: string): Promise<Blob> {
    return fetch(`${BASE}/archives/${encodeURIComponent(archiveId)}/source`, {
      headers: authHeaders(),
    }).then(
      (r) => {
        if (!r.ok) throw new Error(`Failed to fetch source: ${r.status}`);
        return r.blob();
      }
    );
  },

  getArchiveMetadata(archiveId: string): Promise<Record<string, unknown>> {
    return request(`/archives/${encodeURIComponent(archiveId)}/metadata`);
  },

  getArchiveFiles(archiveId: string): Promise<ArchiveFile[]> {
    return request(`/archives/${encodeURIComponent(archiveId)}/files`);
  },

  openArchiveFolder(archiveId: string): Promise<{ status: string; path: string }> {
    return request(`/archives/${encodeURIComponent(archiveId)}/open-folder`, {
      method: 'POST',
    });
  },

  getArchiveStats(): Promise<ArchiveStats> {
    return request('/archives/stats');
  },

  getAutoArchive(): Promise<AutoArchiveSnapshot> {
    return request('/auto-archive');
  },

  updateAutoArchive(config: AutoArchiveConfig): Promise<AutoArchiveSnapshot> {
    return request('/auto-archive', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  runAutoArchive(): Promise<AutoArchiveSnapshot> {
    return request('/auto-archive/run', { method: 'POST' });
  },

  getAutoArchiveLog(logId: string): Promise<AutoArchiveRunDetail> {
    return request(`/auto-archive/logs/${encodeURIComponent(logId)}`);
  },

  getNotifications(): Promise<NotificationSnapshot> {
    return request('/notifications');
  },

  updateNotifications(config: NotificationConfigUpdate): Promise<NotificationSnapshot> {
    return request('/notifications', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  testNotifications(): Promise<NotificationTestResult> {
    return request('/notifications/test', { method: 'POST' });
  },

  getSubmissionMonitor(): Promise<SubmissionMonitorSnapshot> {
    return request('/submission-monitor');
  },

  updateSubmissionMonitor(config: SubmissionMonitorConfig): Promise<SubmissionMonitorSnapshot> {
    return request('/submission-monitor', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  runSubmissionMonitor(): Promise<SubmissionMonitorSnapshot> {
    return request('/submission-monitor/run', { method: 'POST' });
  },

  getSubmissionMonitorLog(logId: string): Promise<SubmissionMonitorRunDetail> {
    return request(`/submission-monitor/logs/${encodeURIComponent(logId)}`);
  },

  getSimulationMonitor(): Promise<SimulationMonitorSnapshot> {
    return request('/simulation-monitor');
  },

  updateSimulationMonitor(config: SimulationMonitorConfig): Promise<SimulationMonitorSnapshot> {
    return request('/simulation-monitor', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  runSimulationMonitor(): Promise<SimulationMonitorSnapshot> {
    return request('/simulation-monitor/run', { method: 'POST' });
  },

  getSimulationMonitorLog(logId: string): Promise<SimulationMonitorRunDetail> {
    return request(`/simulation-monitor/logs/${encodeURIComponent(logId)}`);
  },

  health(): Promise<HealthStatus> {
    return request('/health');
  },
};
