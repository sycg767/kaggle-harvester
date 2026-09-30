import React from 'react';
import { Button, Space, Tooltip, Typography, type TableColumnsType } from 'antd';
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
import CopyButton from '../CopyButton';
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
      <div className="kernel-table-score">
        <TrophyOutlined style={{ color: getScoreColor(score), fontSize: 13 }} />
        <span
          className="kernel-table-score-val"
          style={{ color: getScoreColor(score) }}
        >
          {score === undefined || score === null ? '—' : score.toFixed(4)}
        </span>
      </div>
    ),
  },
  {
    title: 'Kernel',
    key: 'kernel',
    width: 300,
    render: (_, record) => (
      <div className="kernel-col-cell">
        <a
          href={kaggleKernelUrl(record.ref)}
          target="_blank"
          rel="noreferrer"
          className="kernel-col-title"
          title={record.title || record.ref}
        >
          {record.title || record.ref}
        </a>
        <div className="kernel-col-ref-line">
          <span className="kernel-col-ref">{record.ref}</span>
          <CopyButton value={record.ref} label="复制 Kernel ref" />
        </div>
      </div>
    ),
  },
  {
    title: '作者',
    dataIndex: 'author',
    width: 140,
    ellipsis: true,
    render: (author: string, record: ScoredKernel) => {
      const username = kaggleOwnerFromRef(record.ref);
      return (
        <Space align="start" size={6} className="kernel-author-cell">
          <UserOutlined style={{ marginTop: 3, color: '#8e8e93' }} />
          <a
            href={kaggleAuthorUrl(username)}
            target="_blank"
            rel="noreferrer"
            aria-label={`打开 @${username} 的 Kaggle 主页`}
            className="kernel-author-link"
          >
            <span className="kernel-author-name">{author || username}</span>
            <Text type="secondary" className="kernel-author-handle">
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
      <Space size={4} className="kernel-votes-cell">
        <StarOutlined style={{ color: warningColor }} />
        <span className="kernel-votes-val">{votes}</span>
      </Space>
    ),
  },
  {
    title: '最后运行',
    dataIndex: 'last_run_time',
    width: 170,
    render: (value?: string) => (
      <Space size={5} className="kernel-runtime-cell">
        <ClockCircleOutlined style={{ color: '#8e8e93' }} />
        <span className="kernel-runtime-val">{formatDate(value)}</span>
      </Space>
    ),
  },
  {
    title: '归档状态',
    width: 125,
    render: (_, record) => {
      const values = archivedVersions.get(record.ref);
      return values?.length ? (
        <Tooltip title={values.map((value) => `v${value}`).join('、')}>
          <span className="kernel-status-chip is-success">
            <CheckCircleOutlined style={{ fontSize: 11 }} />
            <span>{values.length} 个版本</span>
          </span>
        </Tooltip>
      ) : (
        <span className="kernel-status-chip is-neutral">未归档</span>
      );
    },
  },
  {
    title: '操作',
    fixed: 'right',
    width: 130,
    render: (_, record) => (
      <Space size={6} className="kernel-actions-cell">
        <Tooltip title="查看版本历史">
          <Button
            size="small"
            className="kernel-action-btn-view"
            icon={<EyeOutlined />}
            aria-label={`查看 ${record.ref} 的版本`}
            onClick={() => onShowVersions(record)}
          />
        </Tooltip>
        <Tooltip title="归档最佳版本">
          <Button
            size="small"
            type="primary"
            className="kernel-action-btn-archive"
            icon={<CloudDownloadOutlined />}
            aria-label={`归档 ${record.ref}`}
            onClick={() => onOpenArchive([record])}
          />
        </Tooltip>
      </Space>
    ),
  },
];
