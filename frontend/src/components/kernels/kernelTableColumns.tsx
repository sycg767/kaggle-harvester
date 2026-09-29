import React from 'react';
import { Button, Space, Tag, Tooltip, Typography, type TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  EyeOutlined,
  StarOutlined,
  TrophyOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ScoredKernel } from '../../api';
import type { ScoreDirection } from '../../scoreDirection';
import { kaggleAuthorUrl, kaggleKernelUrl, kaggleOwnerFromRef } from '../../kaggleUrls';
import { comparePublicScores, formatDate, SCORE_SORT_BEST } from './kernelUtils';

const { Text } = Typography;

interface TableColumnsOptions {
  confirmedDirection: ScoreDirection | null;
  getScoreColor: (score?: number) => string;
  archivedVersions: Map<string, number[]>;
  warningColor: string;
  onShowVersions: (kernel: ScoredKernel) => void;
  onOpenArchive: (targets: ScoredKernel[]) => void;
}

export const buildKernelTableColumns = ({
  confirmedDirection,
  getScoreColor,
  archivedVersions,
  warningColor,
  onShowVersions,
  onOpenArchive,
}: TableColumnsOptions): TableColumnsType<ScoredKernel> => [
  {
    title: '分数',
    dataIndex: 'public_score',
    width: 110,
    sorter: (a, b) => {
      const isLowerBetter = confirmedDirection === 'minimize';
      return comparePublicScores(
        a.public_score,
        b.public_score,
        SCORE_SORT_BEST,
        isLowerBetter,
      );
    },
    render: (score?: number) => (
      <Space>
        <TrophyOutlined style={{ color: getScoreColor(score) }} />
        <Text strong style={{ color: getScoreColor(score) }}>
          {score === undefined || score === null ? '—' : score.toFixed(4)}
        </Text>
      </Space>
    ),
  },
  {
    title: 'Kernel',
    key: 'kernel',
    width: 290,
    render: (_, record) => (
      <div style={{ minWidth: 0 }}>
        <a
          href={kaggleKernelUrl(record.ref)}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'block', overflow: 'hidden', fontWeight: 600, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {record.title || record.ref}
        </a>
        <Text type="secondary" ellipsis style={{ display: 'block', fontSize: 12 }}>
          {record.ref}
        </Text>
      </div>
    ),
  },
  {
    title: '作者',
    dataIndex: 'author',
    width: 135,
    ellipsis: true,
    render: (author: string, record: ScoredKernel) => {
      const username = kaggleOwnerFromRef(record.ref);
      return (
        <Space align="start">
          <UserOutlined style={{ marginTop: 4 }} />
          <a
            href={kaggleAuthorUrl(username)}
            target="_blank"
            rel="noreferrer"
            aria-label={`打开 @${username} 的 Kaggle 主页`}
          >
            <span style={{ display: 'block' }}>{author || username}</span>
            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
              @{username}
            </Text>
          </a>
        </Space>
      );
    },
  },
  {
    title: '投票',
    dataIndex: 'total_votes',
    width: 85,
    sorter: (a, b) => a.total_votes - b.total_votes,
    render: (votes: number) => (
      <Space>
        <StarOutlined style={{ color: warningColor }} />
        {votes}
      </Space>
    ),
  },
  {
    title: '最后运行',
    dataIndex: 'last_run_time',
    width: 170,
    render: (value?: string) => (
      <Space>
        <ClockCircleOutlined />
        <Text type="secondary">{formatDate(value)}</Text>
      </Space>
    ),
  },
  {
    title: '本地状态',
    width: 120,
    render: (_, record) => {
      const values = archivedVersions.get(record.ref);
      return values?.length ? (
        <Tooltip title={values.map((value) => `v${value}`).join('、')}>
          <Tag color="success" icon={<CheckCircleOutlined />}>{values.length} 个版本</Tag>
        </Tooltip>
      ) : <Text type="secondary">未归档</Text>;
    },
  },
  {
    title: '操作',
    fixed: 'right',
    width: 125,
    render: (_, record) => (
      <Space size="small">
        <Tooltip title="查看版本历史">
          <Button icon={<EyeOutlined />} aria-label={`查看 ${record.ref} 的版本`} onClick={() => onShowVersions(record)} />
        </Tooltip>
        <Tooltip title="归档最佳版本">
          <Button type="primary" icon={<CloudDownloadOutlined />} aria-label={`归档 ${record.ref}`} onClick={() => onOpenArchive([record])} />
        </Tooltip>
      </Space>
    ),
  },
];
