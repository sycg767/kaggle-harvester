export * from './types/api.ts';

import type {
  ActiveCompetitionInfo,
  ArchiveEntry,
  ArchiveFile,
  ArchiveResult,
  ArchiveStats,
  AutoArchiveConfig,
  AutoArchiveRunDetail,
  AutoArchiveSnapshot,
  CompetitionInfo,
  EnteredCompetition,
  HealthStatus,
  KernelCacheInfo,
  KernelListResult,
  NotificationConfigUpdate,
  NotificationSnapshot,
  NotificationTestResult,
  ScoredKernel,
  SimulationClawbotTestResult,
  SimulationEpisodePageResponse,
  SimulationMonitorConfig,
  SimulationMonitorRunDetail,
  SimulationMonitorSnapshot,
  SubmissionMonitorConfig,
  SubmissionMonitorRunDetail,
  SubmissionMonitorSnapshot,
  VersionScoreList,
} from './types/api.ts';

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

export class ApiError extends Error {
  status?: number;
  kind: 'http' | 'timeout' | 'network';

  constructor(message: string, kind: 'http' | 'timeout' | 'network', status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

export function describeConnectionError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '访问认证未通过，请检查或重新输入访问密钥。';
    if (error.kind === 'timeout') return '服务状态请求超过 15 秒；可能是访问链路延迟或服务繁忙，正在自动重试。';
    if (error.status) return `服务状态请求返回 HTTP ${error.status}，请检查服务或反向代理。正在自动重试。`;
  }
  return '未能完成服务状态请求，请检查网络连接或服务器入口。正在自动重试。';
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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('harvester:auth-required'));
      }
    }
    const fallback = resp.status >= 500 ? '服务暂时不可用，请稍后重试。' : '请求未完成。';
    throw new ApiError((detail || fallback).slice(0, 500), 'http', resp.status);
  }
  return resp.json();
}

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 25_000;

function createTimeoutSignal(timeoutMs: number, userSignal?: AbortSignal | null) {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  const onUserAbort = () => {
    controller.abort();
  };

  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort();
    } else {
      userSignal.addEventListener('abort', onUserAbort, { once: true });
    }
  }

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (userSignal) {
      userSignal.removeEventListener('abort', onUserAbort);
    }
  };

  return {
    signal: controller.signal,
    isTimeout: () => timedOut,
    cleanup,
  };
}

async function request<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutCtx = createTimeoutSignal(timeoutMs, options?.signal);
  try {
    const resp = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...options?.headers },
      ...options,
      signal: timeoutCtx.signal,
    });
    return await parseResponse<T>(resp);
  } catch (err: any) {
    if (timeoutCtx.isTimeout()) {
      throw new ApiError('请求超时，访问链路延迟或服务繁忙，请稍后重试。', 'timeout');
    }
    throw err;
  } finally {
    timeoutCtx.cleanup();
  }
}

export const api = {
  // Competition
  getCompetition(competition?: string, options?: { refresh?: boolean; signal?: AbortSignal; timeoutMs?: number }): Promise<CompetitionInfo> {
    const q = new URLSearchParams();
    if (competition) q.set('competition', competition);
    if (options?.refresh) q.set('refresh', 'true');
    const qs = q.toString();
    return request(`/competition${qs ? `?${qs}` : ''}`, { signal: options?.signal, timeoutMs: options?.timeoutMs });
  },

  listEnteredCompetitions(
    pageSize = 100,
    options?: { refresh?: boolean; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<EnteredCompetition[]> {
    const q = new URLSearchParams();
    q.set('page_size', String(pageSize));
    if (options?.refresh) q.set('refresh', 'true');
    return request(`/competitions/entered?${q.toString()}`, { signal: options?.signal, timeoutMs: options?.timeoutMs });
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
    timeoutMs?: number;
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

    const timeoutMs = params?.timeoutMs ?? 45_000;
    const timeoutCtx = createTimeoutSignal(timeoutMs, params?.signal);

    return fetch(`${BASE}/kernels${qs ? `?${qs}` : ''}`, {
      signal: timeoutCtx.signal,
      headers: authHeaders(),
    })
      .then(async (response) => {
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
      })
      .catch((err: any) => {
        if (timeoutCtx.isTimeout()) {
          throw new Error('拉取 Kernel 列表超时，请检查网络连接后重试。');
        }
        throw err;
      })
      .finally(() => {
        timeoutCtx.cleanup();
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

  openArchiveInCode(archiveId: string): Promise<{ status: string; path: string }> {
    return request(`/archives/${encodeURIComponent(archiveId)}/open-vscode`, {
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

  testNotifications(payload?: NotificationConfigUpdate): Promise<NotificationTestResult> {
    return request('/notifications/test', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
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

  getSimulationEpisodes(
    submissionId: number,
    offset = 0,
    limit = 6,
  ): Promise<SimulationEpisodePageResponse> {
    const q = new URLSearchParams({
      submission_id: String(submissionId),
      offset: String(offset),
      limit: String(limit),
    });
    return request(`/simulation-monitor/episodes?${q.toString()}`);
  },

  getSimulationMonitorLog(logId: string): Promise<SimulationMonitorRunDetail> {
    return request(`/simulation-monitor/logs/${encodeURIComponent(logId)}`);
  },

  testClawbot(): Promise<SimulationClawbotTestResult> {
    return request('/simulation-monitor/clawbot/test', { method: 'POST' });
  },

  listSimulationSubmissions(competition?: string): Promise<Array<{
    submission_id: number;
    description: string;
    file_name: string;
    date: string;
    status: string;
    public_score?: number | null;
    team_name?: string;
  }>> {
    const q = competition ? `?competition=${encodeURIComponent(competition)}` : '';
    return request(`/simulation-monitor/submissions${q}`);
  },

  health(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<HealthStatus> {
    return request('/health', { timeoutMs: options?.timeoutMs ?? 15_000, signal: options?.signal });
  },

  getActiveCompetition(options?: { signal?: AbortSignal }): Promise<ActiveCompetitionInfo> {
    return request('/active-competition', { signal: options?.signal });
  },

  setActiveCompetition(competition: string, options?: { signal?: AbortSignal }): Promise<ActiveCompetitionInfo> {
    return request('/active-competition', {
      method: 'POST',
      body: JSON.stringify({ competition }),
      signal: options?.signal,
    });
  },

  deleteActiveCompetition(options?: { signal?: AbortSignal }): Promise<ActiveCompetitionInfo> {
    return request('/active-competition', {
      method: 'DELETE',
      signal: options?.signal,
    });
  },
};
