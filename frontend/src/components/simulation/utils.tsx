import React from 'react';
import { Tag } from 'antd';
import { TrophyOutlined } from '@ant-design/icons';
import type { SimulationAgentStats } from '../../types/api';

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

export const formatShortTime = (value?: string) => {
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
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatDuration = (seconds: number) => {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
};

export const getMedalTag = (tier?: string) => {
  if (tier === 'gold') {
    return <Tag color="gold" icon={<TrophyOutlined />}>金牌线内</Tag>;
  }
  if (tier === 'silver') {
    return (
      <Tag
        color="default"
        style={{ borderColor: '#cbd5e1', background: '#f1f5f9', color: '#475569' }}
        icon={<TrophyOutlined />}
      >
        银牌线内
      </Tag>
    );
  }
  if (tier === 'bronze') {
    return <Tag color="orange" icon={<TrophyOutlined />}>铜牌线内</Tag>;
  }
  return <Tag color="default">暂无奖牌</Tag>;
};

export const getShortAgentName = (agent: SimulationAgentStats, defaultIdx: number) => {
  if (agent.alias && agent.alias.trim()) return agent.alias.trim();
  if (agent.submission_id === 55565346) return 'p46';
  if (agent.submission_id === 55555162) return 'p31';
  const raw = (agent.description || agent.file_name || '').trim();
  if (/p46/i.test(raw)) return 'p46';
  if (/p3plus31|p31/i.test(raw)) return 'p31';
  const match = raw.match(/^(p\d+(?:plus\d+)?|p\d+)/i);
  if (match) {
    let name = match[1];
    if (/^p3plus31/i.test(name)) name = 'p31';
    return name;
  }
  const fileMatch = (agent.file_name || '').match(/^(p\d+(?:plus\d+)?|p\d+)/i);
  if (fileMatch) {
    let name = fileMatch[1];
    if (/^p3plus31/i.test(name)) name = 'p31';
    return name;
  }
  if (raw && !raw.toLowerCase().startsWith('agent') && raw.length <= 15) {
    return raw.replace(/[:_\-—]+$/, '');
  }
  return `Agent #${defaultIdx + 1}`;
};
