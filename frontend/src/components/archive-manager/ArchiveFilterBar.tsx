import React from 'react';
import {
  Col,
  Input,
  Row,
  Select,
  Typography,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ArchiveEntry } from '../../api';

const { Text } = Typography;

interface ArchiveFilterBarProps {
  searchText: string;
  setSearchText: (value: string) => void;
  competitionFilter: string;
  setCompetitionFilter: (value: string) => void;
  scoredOnly: boolean;
  setScoredOnly: React.Dispatch<React.SetStateAction<boolean>>;
  competitions: string[];
  archives: ArchiveEntry[];
  displayCount: number;
}

export const ArchiveFilterBar: React.FC<ArchiveFilterBarProps> = ({
  searchText,
  setSearchText,
  competitionFilter,
  setCompetitionFilter,
  scoredOnly,
  setScoredOnly,
  competitions,
  archives,
  displayCount,
}) => {
  const scoredCount = archives.filter(
    (a) => a.public_score !== undefined && a.public_score !== null,
  ).length;

  const isAllActive = !scoredOnly && competitionFilter === 'all';

  return (
    <div className="archive-toolbar" role="search" aria-label="归档筛选工具栏">
      <Row gutter={[10, 10]} align="middle" className="archive-toolbar-row-main">
        <Col xs={24} md={14} lg={15}>
          <Input
            className="archive-search-input"
            aria-label="搜索服务器归档"
            allowClear
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            prefix={<SearchOutlined className="archive-search-icon" />}
            placeholder="搜索 Kernel、作者、ref 或服务器路径"
          />
        </Col>
        <Col xs={24} md={10} lg={9}>
          <Select
            className="archive-competition-select"
            aria-label="按竞赛筛选归档"
            value={competitionFilter}
            onChange={setCompetitionFilter}
            style={{ width: '100%' }}
            options={[
              { value: 'all', label: '全部竞赛' },
              ...competitions.map((value) => ({ value, label: value })),
            ]}
          />
        </Col>
      </Row>

      <div className="archive-toolbar-pills-row">
        <div className="archive-pills-left">
          <button
            type="button"
            className={`archive-filter-chip ${isAllActive ? 'is-active' : ''}`}
            onClick={() => {
              setScoredOnly(false);
              setCompetitionFilter('all');
            }}
          >
            全部 <span className="archive-chip-count">{archives.length}</span>
          </button>

          <button
            type="button"
            className={`archive-filter-chip ${scoredOnly ? 'is-active' : ''}`}
            onClick={() => setScoredOnly((curr) => !curr)}
          >
            仅看有分 <span className="archive-chip-count">{scoredCount}</span>
          </button>

          <div className="archive-quick-competitions">
            {competitions.slice(0, 4).map((comp) => {
              const isActive = competitionFilter === comp;
              return (
                <button
                  key={comp}
                  type="button"
                  className={`archive-filter-chip archive-comp-chip ${isActive ? 'is-active' : ''}`}
                  onClick={() => setCompetitionFilter(isActive ? 'all' : comp)}
                  title={comp}
                >
                  <span className="archive-comp-chip-text">{comp}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="archive-pills-right">
          <Text className="archive-match-count">
            匹配 <span className="archive-count-highlight">{displayCount}</span> / {archives.length} 条
          </Text>
        </div>
      </div>
    </div>
  );
};

export default ArchiveFilterBar;
