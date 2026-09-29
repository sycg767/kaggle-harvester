import React from 'react';
import type { CompetitionInfo, KernelCacheInfo } from '../../api';
import type { ScoreDirection } from '../../scoreDirection';
import {
  formatCacheAge,
  formatDate,
  isScoreSort,
  scoreDirectionSourceLabel,
} from './kernelUtils';

interface KernelFreshnessBannerProps {
  cacheInfo: KernelCacheInfo | null;
  sortBy: string;
  confirmedDirection: ScoreDirection | null;
  kernelsCount: number;
  backgroundRefreshing: boolean;
  directionSource: CompetitionInfo['score_direction_source'] | 'user' | 'unknown';
}

const KernelFreshnessBanner: React.FC<KernelFreshnessBannerProps> = ({
  cacheInfo,
  sortBy,
  confirmedDirection,
  kernelsCount,
  backgroundRefreshing,
  directionSource,
}) => {
  if (!cacheInfo) return null;

  return (
    <div
      className={`data-freshness${cacheInfo.refresh_state === 'failed' ? ' is-error' : ''}`}
      role="status"
    >
      <div>
        <strong>数据范围</strong>
        <span>
          {isScoreSort(sortBy) && confirmedDirection
            ? '公开分数榜前 50 条'
            : `当前查询 ${kernelsCount} 条`}
        </span>
      </div>
      <div>
        <strong>快照时间</strong>
        <span>
          {cacheInfo.fetched_at
            ? formatDate(new Date(cacheInfo.fetched_at * 1000).toISOString())
            : formatCacheAge(cacheInfo.age_seconds)}
        </span>
      </div>
      <div>
        <strong>数据状态</strong>
        <span>
          {cacheInfo.refresh_state === 'failed'
            ? '后台刷新失败，正在展示旧数据'
            : backgroundRefreshing
              ? '旧数据可用，后台更新中'
              : cacheInfo.state === 'STALE'
                ? '正在展示旧数据'
                : '快照可用'}
        </span>
      </div>
      <div>
        <strong>方向来源</strong>
        <span>{scoreDirectionSourceLabel(directionSource)}</span>
      </div>
    </div>
  );
};

export default KernelFreshnessBanner;
