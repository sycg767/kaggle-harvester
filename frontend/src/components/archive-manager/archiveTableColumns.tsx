import React from 'react';
import { Button, Tag, Tooltip, Typography, type TableColumnsType } from 'antd';
import {
  CodeOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import type { ArchiveEntry } from '../../api';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../../kaggleUrls';
import CopyButton from '../CopyButton';
import { formatBytes, formatDate, formatScore } from './archiveUtils';

const { Text } = Typography;

interface TableActionHandlers {
  onOpenVsCode: (record: ArchiveEntry) => void;
  onShowDetail: (record: ArchiveEntry) => void;
  onOpenFolder: (record: ArchiveEntry) => void;
  onDownloadSource: (record: ArchiveEntry) => void;
  onDeleteArchives: (records: ArchiveEntry[]) => void;
}

export const createArchiveTableColumns = (
  handlers: TableActionHandlers,
): TableColumnsType<ArchiveEntry> => [
  {
    title: 'Kernel',
    key: 'kernel',
    width: 235,
    render: (_, record) => (
      <div className="kernel-identity">
        <a
          className="kernel-title"
          href={kaggleKernelUrl(record.ref)}
          target="_blank"
          rel="noreferrer"
        >
          {record.title || record.ref}
        </a>
        <span className="kernel-ref-line">
          <span className="kernel-ref">{record.ref}</span>
          <CopyButton value={record.ref} label="复制 Kernel ref" />
        </span>
      </div>
    ),
    sorter: (a, b) => (a.title || a.ref).localeCompare(b.title || b.ref),
  },
  {
    title: '作者',
    dataIndex: 'author',
    width: 100,
    ellipsis: true,
    render: (author: string, record: ArchiveEntry) => {
      const username = kaggleOwnerFromRef(record.ref) || author;
      return (
        <a
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
    width: 125,
    ellipsis: true,
    render: (value?: string) => value || '未登记',
  },
  {
    title: '版本',
    dataIndex: 'version_number',
    width: 64,
    render: (value: number) => <Tag color="blue">v{value}</Tag>,
    sorter: (a, b) => a.version_number - b.version_number,
  },
  {
    title: '公开分数',
    dataIndex: 'public_score',
    width: 86,
    render: (value?: number) =>
      value === undefined || value === null ? (
        <Text type="secondary">—</Text>
      ) : (
        <span className="score-value">{formatScore(value)}</span>
      ),
    sorter: (a, b) => (a.public_score ?? Number.POSITIVE_INFINITY) - (b.public_score ?? Number.POSITIVE_INFINITY),
  },
  {
    title: '文件',
    key: 'files',
    width: 80,
    render: (_, record) => (
      <div>
        <span>{record.file_count || 0} 个</span>
        <span className="kernel-ref">{formatBytes(record.size_bytes)}</span>
      </div>
    ),
    sorter: (a, b) => a.size_bytes - b.size_bytes,
  },
  {
    title: '归档时间',
    dataIndex: 'archived_at',
    width: 130,
    render: formatDate,
    defaultSortOrder: 'descend',
    sorter: (a, b) => new Date(a.archived_at).getTime() - new Date(b.archived_at).getTime(),
  },
  {
    title: '操作',
    key: 'actions',
    width: 175,
    render: (_, record) => (
      <div className="table-actions">
        <Tooltip title="在 VS Code 中打开">
          <Button icon={<CodeOutlined />} aria-label={`用 VS Code 打开 ${record.ref}`} onClick={() => handlers.onOpenVsCode(record)} />
        </Tooltip>
        <Tooltip title="查看详情">
          <Button icon={<EyeOutlined />} aria-label={`查看 ${record.ref}`} onClick={() => handlers.onShowDetail(record)} />
        </Tooltip>
        <Tooltip title="打开目录">
          <Button icon={<FolderOpenOutlined />} aria-label={`打开 ${record.ref} 的目录`} onClick={() => handlers.onOpenFolder(record)} />
        </Tooltip>
        <Tooltip title="下载源文件">
          <Button icon={<DownloadOutlined />} aria-label={`下载 ${record.ref}`} onClick={() => handlers.onDownloadSource(record)} />
        </Tooltip>
        <Tooltip title="删除归档">
          <Button danger icon={<DeleteOutlined />} aria-label={`删除 ${record.ref}`} onClick={() => handlers.onDeleteArchives([record])} />
        </Tooltip>
      </div>
    ),
  },
];
