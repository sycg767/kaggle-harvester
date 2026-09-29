import React from 'react';
import { Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type {
  SubmissionMonitorItem,
  SubmissionMonitorRunLog,
  SubmissionScoreEvent,
} from '../../api';

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
  let normalized = value.trim();
  if (
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(normalized)
    && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
  ) {
    normalized = `${normalized.replace(' ', 'T')}Z`;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export const formatDuration = (seconds: number) => {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
};

export const formatScore = (item: SubmissionMonitorItem | SubmissionScoreEvent) => {
  if (item.public_score_display) return item.public_score_display;
  if (typeof item.public_score === 'number') return item.public_score.toFixed(4);
  return '—';
};

export const renderRunOutcome = (log: SubmissionMonitorRunLog) => {
  if (log.outcome === 'success') {
    return <Tag color="success" icon={<CheckCircleOutlined />}>成功</Tag>;
  }
  if (log.outcome === 'partial') {
    return (
      <Tag color="warning" icon={<ExclamationCircleOutlined />}>部分失败</Tag>
    );
  }
  return (
    <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>
  );
};

export const renderItemState = (item: SubmissionMonitorItem) => {
  if (item.state === 'failed') {
    return <Tag color="error">失败</Tag>;
  }
  if (item.newly_scored) {
    return <Tag color="success">新出分</Tag>;
  }
  if (item.state === 'pending' || item.public_score === undefined || item.public_score === null) {
    return <Tag color="processing">待出分</Tag>;
  }
  return <Tag>已出分</Tag>;
};
