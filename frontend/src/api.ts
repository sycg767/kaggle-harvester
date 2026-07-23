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

export interface AutoArchiveConfig {
  enabled: boolean;
  competition: string;
  score_threshold?: number;
  interval_minutes: number;
  include_outputs: boolean;
  score_direction: 'auto' | 'minimize' | 'maximize';
}

export interface AutoArchiveItemResult {
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
  error?: string;
  details_available: boolean;
}

export interface AutoArchiveCheckedItem {
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
    const fallback = resp.status >= 500 ? '服务暂时不可用，请稍后重试。' : '请求未完成。';
    throw new Error((detail || fallback).slice(0, 500));
  }
  return resp.json();
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
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
    return fetch(`${BASE}/kernels${qs ? `?${qs}` : ''}`, { signal: params?.signal }).then(async (response) => {
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
    return fetch(`${BASE}/archives/${encodeURIComponent(archiveId)}/source`).then(
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

  health(): Promise<HealthStatus> {
    return request('/health');
  },
};
