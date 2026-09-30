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
      className={`kernel-freshness-strip${cacheInfo.refresh_state === 'failed' ? ' is-error' : ''}`}
      role="status"
      aria-label="数据新鲜度快照"
    >
      <div className="kernel-freshness-item">
        <span className="kernel-freshness-label">范围</span>
        <span className="kernel-freshness-value">
          {isScoreSort(sortBy) && confirmedDirection
            ? '公开榜前 50 条'
            : `当前查询 ${kernelsCount} 条`}
        </span>
      </div>
      <span className="kernel-freshness-dot">·</span>
      <div className="kernel-freshness-item">
        <span className="kernel-freshness-label">快照</span>
        <span className="kernel-freshness-value">
          {cacheInfo.fetched_at
            ? formatDate(new Date(cacheInfo.fetched_at * 1000).toISOString())
            : formatCacheAge(cacheInfo.age_seconds)}
        </span>
      </div>
      <span className="kernel-freshness-dot">·</span>
      <div className="kernel-freshness-item">
        <span className="kernel-freshness-label">状态</span>
        <span className="kernel-freshness-value">
          {cacheInfo.refresh_state === 'failed'
            ? '后台刷新失败 (旧数据)'
            : backgroundRefreshing
              ? '更新中'
              : cacheInfo.state === 'STALE'
                ? '旧数据'
                : '快照正常'}
        </span>
      </div>
      <span className="kernel-freshness-dot">·</span>
      <div className="kernel-freshness-item">
        <span className="kernel-freshness-label">方向</span>
        <span className="kernel-freshness-value">{scoreDirectionSourceLabel(directionSource)}</span>
      </div>
    </div>
  );
};

export default KernelFreshnessBanner;
