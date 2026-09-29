import React from 'react';
import { Tag, Tooltip, Typography, type TableColumnsType } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import type { SimulationEpisode } from '../../types/api';
import { formatShortTime } from './utils';

const { Text } = Typography;

export const getSideEpisodeColumns = (): TableColumnsType<SimulationEpisode> => [
  {
    title: '对局 ID',
    dataIndex: 'id',
    key: 'id',
    width: 105,
    render: (id: number, record) => (
      <Tooltip title="点击在 Kaggle 查看官方对战回放 ↗">
        <a
          href={record.replay_url}
          target="_blank"
          rel="noopener noreferrer"
          className="sim-episode-link"
        >
          #{id}
          <ExportOutlined style={{ fontSize: 11 }} />
        </a>
      </Tooltip>
    ),
  },
  {
    title: '时间',
    dataIndex: 'create_time',
    key: 'create_time',
    width: 100,
    render: (time: string) => (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {formatShortTime(time)}
      </Text>
    ),
  },
  {
    title: '对手队伍',
    dataIndex: 'opponent_team_name',
    key: 'opponent_team_name',
    ellipsis: true,
    render: (name: string, record) => {
      const scoreLabel = record.opponent_score ? ` (${record.opponent_score.toFixed(0)}分)` : '';
      return record.is_system_check ? (
        <Text style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
          系统自检
        </Text>
      ) : (
        <Tooltip title={record.opponent_submission_id ? `${name}${scoreLabel} (Sub #${record.opponent_submission_id})` : `${name}${scoreLabel}`}>
          <Text style={{ fontSize: 12 }} ellipsis>
            {name || '对手'}{record.opponent_score ? <span style={{ color: '#94a3b8', fontSize: 11 }}> ({record.opponent_score.toFixed(0)})</span> : null}
          </Text>
        </Tooltip>
      );
    },
  },
  {
    title: (
      <Tooltip title="Kaggle 官方真实对战结算天梯分加减（+ 代表获胜加分，- 代表战败扣分）">
        <span style={{ cursor: 'help', borderBottom: '1px dashed #94a3b8' }}>
          天梯变动
        </span>
      </Tooltip>
    ),
    dataIndex: 'result',
    key: 'result',
    width: 95,
    align: 'center',
    render: (res: string, record) => {
      if (record.is_system_check) {
        return (
          <Tag color="default" style={{ margin: 0, fontSize: 11, fontWeight: 700, borderRadius: 6 }}>
            系统自检 · 不计分
          </Tag>
        );
      }
      const delta = record.score_delta;
      if (res === 'win' || record.reward === 1) {
        const deltaStr = delta !== undefined && delta !== null ? `+${Math.abs(delta).toFixed(1)}` : '+3.0';
        return (
          <Tag color="success" style={{ margin: 0, fontSize: 12, fontWeight: 800, borderRadius: 6, minWidth: 50, textAlign: 'center' }}>
            {deltaStr}
          </Tag>
        );
      }
      if (res === 'loss' || record.reward === -1) {
        const deltaStr = delta !== undefined && delta !== null ? `-${Math.abs(delta).toFixed(1)}` : '-3.0';
        return (
          <Tag color="error" style={{ margin: 0, fontSize: 12, fontWeight: 800, borderRadius: 6, minWidth: 50, textAlign: 'center' }}>
            {deltaStr}
          </Tag>
        );
      }
      if (res === 'tie' || record.reward === 0) {
        return (
          <Tag color="default" style={{ margin: 0, fontSize: 12, fontWeight: 800, borderRadius: 6, minWidth: 50, textAlign: 'center' }}>
            0.0
          </Tag>
        );
      }
      return (
        <Tag color="default" style={{ margin: 0, fontSize: 12, fontWeight: 800, borderRadius: 6, minWidth: 50, textAlign: 'center' }}>
          —
        </Tag>
      );
    },
  },
];
