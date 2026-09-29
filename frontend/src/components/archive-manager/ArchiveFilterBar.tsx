import React from 'react';
import {
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Space,
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

  return (
    <Card size="small" className="data-toolbar">
      <Row gutter={[12, 12]} align="middle">
        <Col xs={24} md={12} lg={10}>
          <Input
            aria-label="搜索本地归档"
            allowClear
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            prefix={<SearchOutlined />}
            placeholder="筛选标题、作者、ref 或路径"
          />
        </Col>
        <Col xs={24} md={7} lg={6}>
          <Select
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
        <Col xs={24} md={5} lg={8} style={{ textAlign: 'right' }}>
          <Text type="secondary">当前显示 {displayCount} 条</Text>
        </Col>
      </Row>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Space wrap size={6}>
          <Button
            size="small"
            type={!scoredOnly && competitionFilter === 'all' ? 'primary' : 'default'}
            onClick={() => {
              setScoredOnly(false);
              setCompetitionFilter('all');
            }}
            style={{ borderRadius: 12, fontSize: 11 }}
          >
            全部 ({archives.length})
          </Button>
          <Button
            size="small"
            type={scoredOnly ? 'primary' : 'default'}
            onClick={() => setScoredOnly((curr) => !curr)}
            style={{ borderRadius: 12, fontSize: 11 }}
          >
            🔥 仅看有分 ({scoredCount})
          </Button>
          {competitions.slice(0, 4).map((comp) => (
            <Button
              key={comp}
              size="small"
              type={competitionFilter === comp ? 'primary' : 'default'}
              onClick={() => setCompetitionFilter(comp === competitionFilter ? 'all' : comp)}
              style={{ borderRadius: 12, fontSize: 11 }}
            >
              🏆 {comp}
            </Button>
          ))}
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          匹配 {displayCount}/{archives.length} 条
        </Text>
      </div>
    </Card>
  );
};

export default ArchiveFilterBar;
