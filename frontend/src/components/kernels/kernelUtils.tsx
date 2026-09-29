import React from 'react';
import { Tag } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import type { CompetitionInfo } from '../../api';

export const DEFAULT_COMPETITION = 'biohub-cell-tracking-during-development';
export const RECENT_COMPETITIONS_KEY = 'harvester.recentCompetitions';
export const MOBILE_PAGE_SIZE = 10;

/** UI 里 scoreAscending = 最佳优先，scoreDescending = 倒序；真正 API 方向按竞赛 metric 映射。 */
export const SCORE_SORT_BEST = 'scoreAscending';
export const SCORE_SORT_REVERSE = 'scoreDescending';

export const isScoreSort = (value: string) =>
  value === SCORE_SORT_BEST || value === SCORE_SORT_REVERSE;

/** 把「最佳优先 / 倒序」映射为 Kaggle 数值升序或降序。 */
export const resolveApiScoreSort = (sortBy: string, isLowerBetter: boolean): string => {
  if (!isScoreSort(sortBy)) return sortBy;
  const bestFirst = sortBy === SCORE_SORT_BEST;
  if (isLowerBetter) {
    return bestFirst ? 'scoreAscending' : 'scoreDescending';
  }
  return bestFirst ? 'scoreDescending' : 'scoreAscending';
};

/** 本地按公开分重排：最佳优先始终把更好的分数排在前面。 */
export const comparePublicScores = (
  leftScore: number | null | undefined,
  rightScore: number | null | undefined,
  sortBy: string,
  isLowerBetter: boolean,
): number => {
  if (leftScore === undefined || leftScore === null) return 1;
  if (rightScore === undefined || rightScore === null) return -1;
  const bestFirst = sortBy === SCORE_SORT_BEST;
  const numericAscending = isLowerBetter ? bestFirst : !bestFirst;
  const delta = leftScore - rightScore;
  return numericAscending ? delta : -delta;
};

export const buildSortOptions = (isLowerBetter: boolean) => [
  {
    value: SCORE_SORT_BEST,
    label: isLowerBetter
      ? '公开分数 · 最佳优先（低→高）'
      : '公开分数 · 最佳优先（高→低）',
  },
  {
    value: SCORE_SORT_REVERSE,
    label: isLowerBetter
      ? '公开分数 · 倒序（高→低）'
      : '公开分数 · 倒序（低→高）',
  },
  { value: 'hotness', label: '热度' },
  { value: 'dateRun', label: '运行时间' },
  { value: 'dateCreated', label: '创建时间' },
  { value: 'voteCount', label: '投票数（非分数榜）' },
];

export type ArchiveVersionChoice = 'best' | 'latest' | `version:${number}`;

export const readRecentCompetitions = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_COMPETITIONS_KEY) || '[]');
    if (Array.isArray(stored)) {
      return stored.filter((value): value is string => typeof value === 'string');
    }
  } catch {
    // 缓存格式异常时回退到默认竞赛，不影响页面使用。
  }
  return [];
};

export const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

export const formatCacheAge = (seconds: number) => {
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
};

export const scoreDirectionSourceLabel = (source?: CompetitionInfo['score_direction_source'] | 'user' | 'unknown') => ({
  api: '竞赛 API',
  leaderboard: '公开排行榜',
  metric: '评价指标推断',
  fallback: '兼容默认值',
  user: '用户确认',
  unknown: '未确认',
}[source || 'unknown']);

export const waitForRefreshPoll = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    window.clearTimeout(timer);
    reject(new DOMException('请求已取消', 'AbortError'));
  }, { once: true });
});

export const renderVersionStatus = (value?: string) => {
  const normalized = (value || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  if (['complete', 'completed', 'success', 'succeeded'].includes(normalized)) {
    return <Tag color="success" icon={<CheckCircleOutlined />}>已完成</Tag>;
  }
  if (['running', 'active'].includes(normalized)) {
    return <Tag color="processing" icon={<LoadingOutlined />}>运行中</Tag>;
  }
  if (['queued', 'pending', 'submitted'].includes(normalized)) {
    return <Tag color="gold" icon={<ClockCircleOutlined />}>排队中</Tag>;
  }
  if (['failed', 'error'].includes(normalized)) {
    return <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>;
  }
  if (normalized.includes('cancel')) {
    const label = normalized.includes('request') ? '取消中' : '已取消';
    return <Tag color="warning" icon={<MinusCircleOutlined />}>{label}</Tag>;
  }
  if (normalized === 'draft') {
    return <Tag>草稿</Tag>;
  }
  return <Tag>{value || '未知'}</Tag>;
};
