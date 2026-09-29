import React from 'react';
import { Tag, Tooltip, Typography, type TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { AutoArchiveCheckedItem, AutoArchiveRunLog } from '../../api';
import {
  kaggleAuthorUrl,
  kaggleKernelUrl,
  kaggleOwnerFromRef,
} from '../../kaggleUrls';

const { Text } = Typography;

export interface SummaryItemProps {
  label: string;
  children: React.ReactNode;
  tabular?: boolean;
}

export const SummaryItem: React.FC<SummaryItemProps> = ({ label, children, tabular = false }) => (
  <div className="auto-archive-summary-item">
    <span className="auto-archive-summary-label">{label}</span>
    <div className={`auto-archive-summary-value${tabular ? ' is-tabular' : ''}`}>{children}</div>
  </div>
);

export const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

export const formatDuration = (seconds: number) => {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
};

export const renderRunOutcome = (log: AutoArchiveRunLog) => {
  if (log.outcome === 'success') {
    return <Tag color="success" icon={<CheckCircleOutlined />}>成功</Tag>;
  }
  if (log.outcome === 'partial') {
    return (
      <Tooltip title={log.error || '部分 Kernel 处理失败'}>
        <Tag color="warning" icon={<ExclamationCircleOutlined />}>部分失败</Tag>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={log.error || '检查失败'}>
      <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>
    </Tooltip>
  );
};

export const renderCheckedAction = (item: AutoArchiveCheckedItem) => {
  if (item.action === 'archived') {
    return <Tag color="success" icon={<CheckCircleOutlined />}>已归档</Tag>;
  }
  if (item.action === 'skipped') return <Tag color="blue">已处理</Tag>;
  if (item.action === 'failed') {
    return (
      <Tooltip title={item.error || '归档失败'}>
        <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>
      </Tooltip>
    );
  }
  return <Tag>未命中</Tag>;
};

export const autoArchiveDetailColumns: TableColumnsType<AutoArchiveCheckedItem> = [
  {
    title: '竞赛',
    dataIndex: 'competition',
    width: 150,
    ellipsis: true,
    render: (value?: string) => value || '—',
  },
  {
    title: '分数',
    dataIndex: 'public_score',
    width: 92,
    sorter: (a, b) => (a.public_score ?? Number.POSITIVE_INFINITY) - (b.public_score ?? Number.POSITIVE_INFINITY),
    render: (value?: number) => value === undefined || value === null ? '—' : <Text strong>{value.toFixed(4)}</Text>,
  },
  {
    title: 'Kernel',
    key: 'kernel',
    width: 300,
    render: (_, item) => (
      <div style={{ minWidth: 0 }}>
        <a href={kaggleKernelUrl(item.ref)} target="_blank" rel="noreferrer" className="kernel-title">
          {item.title || item.ref}
        </a>
        <Text type="secondary" className="kernel-ref">{item.ref}</Text>
      </div>
    ),
  },
  {
    title: '作者',
    dataIndex: 'author',
    width: 135,
    ellipsis: true,
    render: (value: string, item) => {
      const owner = kaggleOwnerFromRef(item.ref);
      return <a href={kaggleAuthorUrl(owner)} target="_blank" rel="noreferrer">{value || owner}</a>;
    },
  },
  {
    title: '最后运行',
    dataIndex: 'last_run_time',
    width: 170,
    render: formatDate,
  },
  {
    title: '处理结果',
    key: 'action',
    width: 110,
    render: (_, item) => renderCheckedAction(item),
  },
  {
    title: '版本',
    dataIndex: 'version_number',
    width: 75,
    render: (value?: number) => value ? `v${value}` : '—',
  },
];
