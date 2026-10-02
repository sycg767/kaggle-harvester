import { apiAuth, ApiError } from './api.ts';

export interface SourcePreview { archive_id: string; filename: string; content: string; truncated: boolean }
export interface SourceComparison { archive_id: string; other_id: string; diff: string; truncated: boolean }
async function request<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const key = apiAuth.getKey();
    const response = await fetch(`/api/archives${path}`, {
      method: 'GET', signal: controller.signal,
      headers: key ? { 'X-Harvester-Key': key } : {},
    });
    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('harvester:auth-required'));
      let detail = '';
      try { const data = await response.json(); if (typeof data.detail === 'string') detail = data.detail; } catch { /* use fallback */ }
      throw new ApiError(detail || `归档请求失败（HTTP ${response.status}）`, 'http', response.status);
    }
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError('归档请求超时，请重试。', 'timeout');
    if (error instanceof ApiError) throw error;
    throw new ApiError('无法读取服务器归档，请检查连接后重试。', 'network');
  } finally { clearTimeout(timer); }
}

const idPath = (id: string) => `/${encodeURIComponent(id)}`;
export const archiveSourceApi = {
  preview: (id: string) => request<SourcePreview>(`${idPath(id)}/preview`),
  compare: (id: string, otherId: string) => request<SourceComparison>(`${idPath(id)}/compare?other_id=${encodeURIComponent(otherId)}`),
};
