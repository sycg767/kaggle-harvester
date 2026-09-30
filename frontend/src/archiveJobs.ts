import { apiAuth, ApiError, type ArchiveResult } from './api.ts';

export interface ArchiveJobRequest {
  kernel_ref: string;
  version?: number;
  score_direction: string;
  include_outputs: boolean;
  competition: string;
}
export interface ArchiveJob {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  persistence_error?: string | null;
  items: Array<{
    id: string;
    request: ArchiveJobRequest;
    status: string;
    result?: ArchiveResult | null;
    error?: string | null;
  }>;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/archive-jobs${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Harvester-Key': apiAuth.getKey() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('harvester:auth-required'));
    throw new ApiError(`归档任务请求失败（HTTP ${response.status}）`, 'http', response.status);
  }
  return response.json();
}

export const archiveJobs = {
  list: (competition?: string) => request<ArchiveJob[]>(competition ? `?competition=${encodeURIComponent(competition)}` : ''),
  create: (items: ArchiveJobRequest[], requestId: string) => request<ArchiveJob>('', { items, request_id: requestId }),
  retry: (id: string) => request<ArchiveJob>(`/${encodeURIComponent(id)}/retry`, {}),
  cancel: (id: string) => request<ArchiveJob>(`/${encodeURIComponent(id)}/cancel`, {}),
};

export function summarizeArchiveJob(job: ArchiveJob) {
  const count = (state: string) => job.items.filter(item => item.status === state).length;
  const done = job.items.filter(item => !['pending', 'running'].includes(item.status)).length;
  return { added: count('succeeded'), existing: count('existing'), failed: count('failed'),
    cancelled: count('cancelled'), pending: count('pending'), running: count('running'),
    percent: job.items.length ? Math.round(done * 100 / job.items.length) : 0 };
}
