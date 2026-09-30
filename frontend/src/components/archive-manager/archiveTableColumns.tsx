import React from 'react';
import {
  Button,
  Space,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import type { ArchiveEntry } from '../../api';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../../kaggleUrls';
import CopyButton from '../CopyButton';
import { formatBytes, formatDateParts, formatScore } from './archiveUtils';

const { Text } = Typography;

interface TableActionHandlers {
  onShowDetail: (record: ArchiveEntry) => void;
  onDownloadSource: (record: ArchiveEntry) => void;
  onDeleteArchives: (records: ArchiveEntry[]) => void;
}

export const createArchiveTableColumns = (
  handlers: TableActionHandlers,
): TableColumnsType<ArchiveEntry> => [
  {
    title: 'Kernel',
    key: 'kernel',
    width: 260,
    render: (_, record) => (
      <div className="archive-table-kernel-cell">
        <a
          className="archive-table-kernel-title"
          href={kaggleKernelUrl(record.ref)}
          target="_blank"
          rel="noreferrer"
          title={record.title || record.ref}
        >
          {record.title || record.ref}
        </a>
        <div className="archive-table-ref-row">
          <span className="archive-table-ref-text" title={record.ref}>
            {record.ref}
          </span>
          <CopyButton value={record.ref} label="复制 Kernel ref" />
        </div>
      </div>
    ),
    sorter: (a, b) => (a.title || a.ref).localeCompare(b.title || b.ref),
  },
  {
    title: '作者',
    dataIndex: 'author',
    width: 110,
    ellipsis: true,
    render: (author: string, record: ArchiveEntry) => {
      const username = kaggleOwnerFromRef(record.ref) || author;
      return (
        <a
          className="archive-table-author-link"
          href={kaggleAuthorUrl(username)}
          target="_blank"
          rel="noreferrer"
          aria-label={`打开 @${username} 的 Kaggle 主页`}
        >
          @{username}
        </a>
      );
    },
  },
  {
    title: '竞赛',
    dataIndex: 'competition',
    width: 130,
    ellipsis: true,
    render: (value?: string) => (
      <span className="archive-table-competition" title={value || '未登记'}>
        {value || '未登记'}
      </span>
    ),
  },
  {
    title: '版本',
    dataIndex: 'version_number',
    width: 72,
    align: 'center',
    render: (value: number) => (
      <Tag className="archive-version-pill">v{value}</Tag>
    ),
    sorter: (a, b) => a.version_number - b.version_number,
  },
  {
    title: '公开分数',
    dataIndex: 'public_score',
    width: 96,
    render: (value?: number) =>
      value === undefined || value === null ? (
        <Text type="secondary" className="archive-table-score-empty">—</Text>
      ) : (
        <span className="archive-table-score-val">{formatScore(value)}</span>
      ),
    sorter: (a, b) => (a.public_score ?? Number.POSITIVE_INFINITY) - (b.public_score ?? Number.POSITIVE_INFINITY),
  },
  {
    title: '文件',
    key: 'files',
    width: 90,
    render: (_, record) => (
      <div className="archive-table-file-cell">
        <span className="archive-table-file-count">{record.file_count || 0} 个文件</span>
        <span className="archive-table-file-size">{formatBytes(record.size_bytes)}</span>
      </div>
    ),
    sorter: (a, b) => a.size_bytes - b.size_bytes,
  },
  {
    title: '归档时间',
    dataIndex: 'archived_at',
    width: 110,
    render: (value: string) => {
      const { date, time } = formatDateParts(value);
      return (
        <div className="archive-table-time-cell">
          <span className="archive-table-time-date">{date}</span>
          {time && <span className="archive-table-time-hour">{time}</span>}
        </div>
      );
    },
    defaultSortOrder: 'descend',
    sorter: (a, b) => new Date(a.archived_at).getTime() - new Date(b.archived_at).getTime(),
  },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    render: (_, record) => (
      <Space size={6} className="archive-table-actions">
        <Tooltip title="查看详情">
          <Button
            size="small"
            className="archive-table-btn"
            icon={<EyeOutlined />}
            aria-label={`查看 ${record.ref}`}
            onClick={() => handlers.onShowDetail(record)}
          />
        </Tooltip>
        <Tooltip title="下载源文件">
          <Button
            size="small"
            className="archive-table-btn"
            icon={<DownloadOutlined />}
            aria-label={`下载 ${record.ref}`}
            onClick={() => handlers.onDownloadSource(record)}
          />
        </Tooltip>
        <Tooltip title="删除归档">
          <Button
            size="small"
            danger
            className="archive-table-btn archive-table-btn-delete"
            icon={<DeleteOutlined />}
            aria-label={`删除 ${record.ref}`}
            onClick={() => handlers.onDeleteArchives([record])}
          />
        </Tooltip>
      </Space>
    ),
  },
];

export default createArchiveTableColumns;
