import React from 'react';
import {
  AutoComplete,
  Button,
  Col,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Tooltip,
  type InputRef,
} from 'antd';
import {
  Archive,
  Filter,
  Zap,
} from 'lucide-react';
import {
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import type {
  ActiveCompetitionInfo,
  CompetitionInfo,
  EnteredCompetition,
  KernelCacheInfo,
} from '../../api';
import type { ScoreDirection } from '../../scoreDirection';
import {
  formatCacheAge,
  isScoreSort,
} from './kernelUtils';

interface KernelFilterBarProps {
  competitionInput: string;
  setCompetitionInput: (value: string) => void;
  competitionInputRef: React.Ref<InputRef>;
  competitionOptions: Array<{ value: string; label: React.ReactNode }>;
  filterCompetitionOption: (inputValue: string, option?: { value?: string | number; label?: React.ReactNode }) => boolean;
  enteredLoading: boolean;
  enteredError: string | null;
  enteredCompetitions: EnteredCompetition[];
  competition: string;
  activeCompInfo: ActiveCompetitionInfo | null;
  settingDefault: boolean;
  togglePinActiveCompetition: () => void;
  loadEnteredCompetitions: (refresh?: boolean) => Promise<void>;
  loadKernels: (refresh?: boolean, nextComp?: string) => Promise<void>;
  searchText: string;
  setSearchText: (value: string) => void;
  sortBy: string;
  setSortBy: (value: string) => void;
  sortOptions: Array<{ value: string; label: string }>;
  loading: boolean;
  mobileFiltersOpen: boolean;
  setMobileFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  scoreFilter: string;
  setScoreFilter: (value: string) => void;
  archivedOnly: boolean;
  setArchivedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  kernelsCount: number;
  scoredCount: number;
  displayCount: number;
  cacheInfo: KernelCacheInfo | null;
  backgroundRefreshing: boolean;
  competitionInfo: CompetitionInfo | null;
  confirmedDirection: ScoreDirection | null;
  pageSize: number;
  setPageSize: (value: number) => void;
  maxPages: number;
  setMaxPages: (value: number) => void;
  scoreLimit: number;
  setScoreLimit: (value: number) => void;
}

export const KernelFilterBar: React.FC<KernelFilterBarProps> = ({
  competitionInput,
  setCompetitionInput,
  competitionInputRef,
  competitionOptions,
  filterCompetitionOption,
  enteredLoading,
  enteredError,
  enteredCompetitions,
  competition,
  activeCompInfo,
  settingDefault,
  togglePinActiveCompetition,
  loadEnteredCompetitions,
  loadKernels,
  searchText,
  setSearchText,
  sortBy,
  setSortBy,
  sortOptions,
  loading,
  mobileFiltersOpen,
  setMobileFiltersOpen,
  scoreFilter,
  setScoreFilter,
  archivedOnly,
  setArchivedOnly,
  kernelsCount,
  scoredCount,
  displayCount,
  cacheInfo,
  backgroundRefreshing,
  competitionInfo,
  confirmedDirection,
  pageSize,
  setPageSize,
  maxPages,
  setMaxPages,
  scoreLimit,
  setScoreLimit,
}) => {
  const isPinned = activeCompInfo?.competition === competition && activeCompInfo?.is_pinned;

  return (
    <div className="kernel-toolbar" role="search" aria-label="Kernel 检索与筛选">
      {/* 组 1：工作区（竞赛选择 + 刷新 + 主攻） */}
      <div className="kernel-toolbar-section kernel-toolbar-workspace">
        <div className="kernel-toolbar-comp-wrap">
          <Space.Compact style={{ width: '100%' }}>
            <AutoComplete
              className="overview-competition-select"
              style={{ width: '100%' }}
              value={competitionInput}
              options={competitionOptions}
              onChange={setCompetitionInput}
              onSelect={(value) => {
                const next = String(value);
                setCompetitionInput(next);
                void loadKernels(false, next);
              }}
              filterOption={filterCompetitionOption}
              defaultActiveFirstOption={false}
              notFoundContent={
                enteredLoading
                  ? '加载已参加竞赛…'
                  : enteredError || '无匹配竞赛，可直接输入 slug'
              }
            >
              <Input
                ref={competitionInputRef}
                aria-label="选择或输入 Kaggle 竞赛标识"
                prefix={<TrophyOutlined style={{ color: '#007aff' }} />}
                suffix={enteredLoading ? <LoadingOutlined spin /> : undefined}
                placeholder={
                  enteredCompetitions.length
                    ? `已参加 ${enteredCompetitions.length} 个 · 点选或输入`
                    : '加载已参加竞赛 / 输入 slug'
                }
                onPressEnter={() => loadKernels(false)}
              />
            </AutoComplete>
            <Tooltip title="刷新已参加竞赛列表">
              <Button
                className="kernel-comp-reload-btn"
                icon={<ReloadOutlined />}
                loading={enteredLoading}
                aria-label="刷新已参加竞赛"
                onClick={() => void loadEnteredCompetitions(true)}
              />
            </Tooltip>
            {/* Desktop 常驻紧凑主攻按钮 */}
            <Tooltip
              title={
                isPinned
                  ? '当前竞赛已设为「全站主攻赛事」。点击取消。'
                  : '设为全站主攻赛事'
              }
            >
              <Button
                className={`kernel-pin-btn-desktop ${isPinned ? 'kernel-pinned-active' : ''}`}
                icon={
                  isPinned ? (
                    <StarFilled style={{ color: '#f59e0b' }} />
                  ) : (
                    <StarOutlined />
                  )
                }
                loading={settingDefault}
                aria-label="设为全站默认主攻赛事"
                onClick={togglePinActiveCompetition}
              >
                {isPinned ? '主攻' : undefined}
              </Button>
            </Tooltip>
          </Space.Compact>
        </div>

        {/* 手机端专用整行主攻按钮 */}
        <div className="kernel-toolbar-pin-mobile">
          <Button
            className={`kernel-pin-btn-mobile ${isPinned ? 'kernel-pinned-active' : ''}`}
            icon={
              isPinned ? (
                <StarFilled style={{ color: '#f59e0b' }} />
              ) : (
                <StarOutlined />
              )
            }
            loading={settingDefault}
            onClick={togglePinActiveCompetition}
          >
            {isPinned ? '已设为全站主攻赛事' : '设为全站主攻赛事'}
          </Button>
        </div>
      </div>

      {/* 组 2：搜索与操作 */}
      <div className="kernel-toolbar-section kernel-toolbar-search-section">
        <Input
          className="kernel-search-input"
          allowClear
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          prefix={<SearchOutlined style={{ color: '#8e8e93' }} />}
          placeholder="过滤当前 Notebook 标题、作者..."
          aria-label="过滤当前 Notebook"
        />

        <div className="kernel-desktop-sort">
          <Select
            aria-label="Kernel 排序方式"
            value={sortBy}
            onChange={setSortBy}
            style={{ width: 176 }}
            options={sortOptions}
          />
        </div>

        <div className="kernel-action-btns">
          <Button
            type="primary"
            className="kernel-btn-primary"
            icon={<SearchOutlined />}
            loading={loading}
            onClick={() => loadKernels(false)}
            title="重新向 Kaggle 检索榜单"
          >
            查询
          </Button>
          <Button
            className="kernel-btn-filter-toggle"
            icon={<Filter size={14} />}
            type={mobileFiltersOpen ? 'primary' : 'default'}
            onClick={() => setMobileFiltersOpen((curr) => !curr)}
            title="排序与高级设置"
          >
            排序/筛选
          </Button>
        </div>
      </div>

      {/* 组 3：状态标签与快捷过滤 */}
      <div className="kernel-toolbar-section kernel-toolbar-pills-section">
        <div className="kernel-pills-row">
          <div className="kernel-pills-segmented" role="group" aria-label="快捷过滤">
            <button
              type="button"
              className={`kernel-pill-btn ${scoreFilter === 'all' && !archivedOnly ? 'is-active' : ''}`}
              onClick={() => { setScoreFilter('all'); setArchivedOnly(false); }}
            >
              全部 <span className="kernel-pill-count">{kernelsCount}</span>
            </button>
            <button
              type="button"
              className={`kernel-pill-btn ${scoreFilter === 'scored' && !archivedOnly ? 'is-active' : ''}`}
              onClick={() => { setScoreFilter('scored'); setArchivedOnly(false); }}
            >
              <Zap size={13} className="kernel-pill-icon" />
              <span>仅看有分</span>
              <span className="kernel-pill-count">{scoredCount}</span>
            </button>
            <button
              type="button"
              className={`kernel-pill-btn ${archivedOnly ? 'is-active' : ''}`}
              onClick={() => setArchivedOnly((curr) => !curr)}
            >
              <Archive size={13} className="kernel-pill-icon" />
              <span>仅看本地已归档</span>
            </button>
          </div>
        </div>

        <div className="kernel-status-chips-row">
          {cacheInfo && (
            <Tooltip
              title={
                cacheInfo.state === 'HIT'
                  ? '本次未访问 Kaggle，直接读取磁盘快照'
                  : cacheInfo.state === 'STALE'
                  ? backgroundRefreshing
                    ? '正在展示上次成功榜单，后台同步检查新版本'
                    : '后台检查未完成，继续展示上次成功榜单'
                  : '本次结果已写入磁盘缓存'
              }
            >
              <span className={`kernel-status-chip ${backgroundRefreshing ? 'is-blue' : cacheInfo.state === 'STALE' ? 'is-warning' : cacheInfo.state === 'HIT' ? 'is-success' : 'is-neutral'}`}>
                {backgroundRefreshing
                  ? `后台更新中 · ${formatCacheAge(cacheInfo.age_seconds)}`
                  : cacheInfo.state === 'HIT'
                  ? `缓存 · ${formatCacheAge(cacheInfo.age_seconds)}`
                  : cacheInfo.state === 'REFRESH'
                  ? '已强制刷新'
                  : cacheInfo.state === 'UPDATE'
                  ? '榜单已更新'
                  : cacheInfo.state === 'STALE'
                  ? '使用旧榜单'
                  : '已建立缓存'}
              </span>
            </Tooltip>
          )}
          {competitionInfo && confirmedDirection && (
            <Tooltip title={competitionInfo.score_direction_source === 'fallback' ? '该方向由你确认并保存在当前浏览器' : '已根据竞赛信息或公开榜单识别'}>
              <span className="kernel-status-chip is-blue">
                {confirmedDirection === 'minimize' ? '越低越好' : '越高越好'}
              </span>
            </Tooltip>
          )}
          <span className="kernel-match-count">匹配 {displayCount}/{kernelsCount} 条</span>
        </div>
      </div>

      {/* 高级配置折叠区 */}
      <div className={`kernel-advanced-panel${mobileFiltersOpen ? ' is-open' : ''}`}>
        <div className="kernel-panel-hairline" />
        <Row gutter={[10, 10]} align="middle" className="kernel-advanced-grid">
          <Col xs={24} md={0} className="mobile-only-sort" style={{ width: '100%' }}>
            <Select
              aria-label="Kernel 排序方式"
              value={sortBy}
              onChange={setSortBy}
              style={{ width: '100%' }}
              options={sortOptions}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Select
              aria-label="分数筛选"
              value={scoreFilter}
              onChange={setScoreFilter}
              style={{ width: '100%' }}
              options={[
                { value: 'all', label: '全部分数' },
                { value: 'scored', label: '已有分数' },
                { value: 'unscored', label: '暂无分数' },
              ]}
            />
          </Col>
          {!isScoreSort(sortBy) && (
            <>
              <Col xs={12} sm={6} md={6}>
                <InputNumber aria-label="每页 Kernel 数量" min={10} max={200} step={10} value={pageSize} onChange={(value) => setPageSize(value || 50)} style={{ width: '100%' }} addonBefore="每页" />
              </Col>
              <Col xs={12} sm={6} md={6}>
                <InputNumber aria-label="读取页数" min={1} max={10} value={maxPages} onChange={(value) => setMaxPages(value || 1)} style={{ width: '100%' }} addonBefore="页数" />
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Select aria-label="读取分数数量" value={scoreLimit} onChange={setScoreLimit} style={{ width: '100%' }} options={[10, 20, 30, 50].map((value) => ({ value, label: `读取前 ${value} 条分数` }))} />
              </Col>
            </>
          )}
        </Row>
      </div>
    </div>
  );
};

export default KernelFilterBar;
