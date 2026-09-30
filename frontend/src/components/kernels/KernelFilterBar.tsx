import React from 'react';
import {
  AutoComplete,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  type InputRef,
} from 'antd';
import {
  Filter,
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

const { Text } = Typography;

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
  return (
    <Card size="small" className="data-toolbar">
      <Row gutter={[8, 8]} align="middle" className="toolbar-primary-row">
        {/* 竞赛切换 */}
        <Col xs={24} md={8} lg={8} className="toolbar-competition-control">
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
                prefix={<TrophyOutlined />}
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
                icon={<ReloadOutlined />}
                loading={enteredLoading}
                aria-label="刷新已参加竞赛"
                onClick={() => void loadEnteredCompetitions(true)}
              />
            </Tooltip>
            <Tooltip
              title={
                activeCompInfo?.competition === competition && activeCompInfo?.is_pinned
                  ? '当前竞赛已设为「全站主攻赛事」。点击取消。'
                  : '设为全站主攻赛事'
              }
            >
              <Button
                icon={
                  activeCompInfo?.competition === competition && activeCompInfo?.is_pinned ? (
                    <StarFilled style={{ color: '#faad14' }} />
                  ) : activeCompInfo?.competition === competition ? (
                    <StarOutlined style={{ color: '#faad14' }} />
                  ) : (
                    <StarOutlined />
                  )
                }
                loading={settingDefault}
                aria-label="设为全站默认主攻赛事"
                onClick={togglePinActiveCompetition}
              >
                {activeCompInfo?.competition === competition && activeCompInfo?.is_pinned
                  ? '主攻'
                  : undefined}
              </Button>
            </Tooltip>
          </Space.Compact>
        </Col>

        {/* 实时本地关键词过滤 */}
        <Col xs={24} md={7} lg={7}>
          <Input
            allowClear
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            placeholder="过滤当前 Notebook 标题、作者..."
            aria-label="过滤当前 Notebook"
          />
        </Col>

        {/* 排序方式 (桌面端常驻) */}
        <Col xs={0} md={5} lg={5} className="desktop-sort-control">
          <Select
            aria-label="Kernel 排序方式"
            value={sortBy}
            onChange={setSortBy}
            style={{ width: '100%' }}
            options={sortOptions}
          />
        </Col>

        {/* 快捷操作与高级展开 */}
        <Col xs={24} md={4} lg={4} style={{ textAlign: 'right' }}>
          <Space size={6} style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={loading}
              onClick={() => loadKernels(false)}
              title="重新向 Kaggle 检索榜单"
            >
              查询
            </Button>
            <Button
              icon={<Filter size={14} />}
              type={mobileFiltersOpen ? 'primary' : 'default'}
              onClick={() => setMobileFiltersOpen((curr) => !curr)}
              title="排序与高级设置"
            >
              排序/筛选
            </Button>
          </Space>
        </Col>
      </Row>

      {/* 快捷过滤 Pills 与状态指示 */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Space size={6} wrap>
          <span style={{ fontSize: 12, color: '#64748b' }}>过滤:</span>
          <Button
            size="small"
            type={scoreFilter === 'all' && !archivedOnly ? 'primary' : 'default'}
            onClick={() => { setScoreFilter('all'); setArchivedOnly(false); }}
            style={{ borderRadius: 12, fontSize: 11 }}
          >
            全部 ({kernelsCount})
          </Button>
          <Button
            size="small"
            type={scoreFilter === 'scored' && !archivedOnly ? 'primary' : 'default'}
            onClick={() => { setScoreFilter('scored'); setArchivedOnly(false); }}
            style={{ borderRadius: 12, fontSize: 11 }}
          >
            🔥 仅看有分 ({scoredCount})
          </Button>
          <Button
            size="small"
            type={archivedOnly ? 'primary' : 'default'}
            onClick={() => setArchivedOnly((curr) => !curr)}
            style={{ borderRadius: 12, fontSize: 11 }}
          >
            💾 仅看本地已归档
          </Button>
        </Space>

        <Space wrap size={6} className="kernel-filter-status">
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
              <Tag color={backgroundRefreshing ? 'processing' : cacheInfo.state === 'STALE' ? 'orange' : cacheInfo.state === 'HIT' ? 'green' : undefined}>
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
              </Tag>
            </Tooltip>
          )}
          {competitionInfo && confirmedDirection && (
            <Tooltip title={competitionInfo.score_direction_source === 'fallback' ? '该方向由你确认并保存在当前浏览器' : '已根据竞赛信息或公开榜单识别'}>
              <Tag color={competitionInfo.score_direction_source === 'fallback' ? 'cyan' : 'blue'}>
                {confirmedDirection === 'minimize' ? '越低越好' : '越高越好'}
              </Tag>
            </Tooltip>
          )}
          <Text type="secondary" className="kernel-score-count">匹配 {displayCount}/{kernelsCount} 条</Text>
        </Space>
      </div>

      {/* 高级配置折叠区 */}
      <div className={`toolbar-advanced${mobileFiltersOpen ? ' is-open' : ''}`}>
        <div className="toolbar-divider" />
        <Row gutter={[8, 8]} align="middle">
          <Col xs={24} md={0} className="mobile-only" style={{ width: '100%' }}>
            <Select
              aria-label="Kernel 排序方式"
              value={sortBy}
              onChange={setSortBy}
              style={{ width: '100%' }}
              options={sortOptions}
            />
          </Col>
          <Col xs={24} md={6}>
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
              <Col xs={12} md={6}>
                <InputNumber aria-label="每页 Kernel 数量" min={10} max={200} step={10} value={pageSize} onChange={(value) => setPageSize(value || 50)} style={{ width: '100%' }} addonBefore="每页" />
              </Col>
              <Col xs={12} md={6}>
                <InputNumber aria-label="读取页数" min={1} max={10} value={maxPages} onChange={(value) => setMaxPages(value || 1)} style={{ width: '100%' }} addonBefore="页数" />
              </Col>
              <Col xs={24} md={6}>
                <Select aria-label="读取分数数量" value={scoreLimit} onChange={setScoreLimit} style={{ width: '100%' }} options={[10, 20, 30, 50].map((value) => ({ value, label: `读取前 ${value} 条分数` }))} />
              </Col>
            </>
          )}
        </Row>
      </div>
    </Card>
  );
};

export default KernelFilterBar;
