import { api, type EnteredCompetition } from './api';

/** 前端会话级缓存：弹窗反复打开不重复打后端/Kaggle。 */
let memoryItems: EnteredCompetition[] | null = null;
let inflight: Promise<EnteredCompetition[]> | null = null;

export async function getEnteredCompetitions(options?: {
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<EnteredCompetition[]> {
  const refresh = Boolean(options?.refresh);
  if (!refresh && memoryItems && memoryItems.length > 0) {
    return memoryItems;
  }
  if (!refresh && inflight) {
    return inflight;
  }

  const request = api
    .listEnteredCompetitions(100, {
      // 会话内曾拿到空列表时，强制后端重拉，避免空缓存长期挡住。
      refresh: refresh || memoryItems?.length === 0,
      signal: options?.signal,
    })
    .then((items) => {
      if (items.length > 0 || refresh) {
        memoryItems = items;
      }
      return items;
    })
    .finally(() => {
      if (inflight === request) {
        inflight = null;
      }
    });

  inflight = request;
  return request;
}

export function peekEnteredCompetitions(): EnteredCompetition[] | null {
  return memoryItems;
}

export function clearEnteredCompetitionsMemory(): void {
  memoryItems = null;
}
