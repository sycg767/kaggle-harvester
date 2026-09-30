import React from 'react';
import { Space, Tag, Select, Button } from 'antd';
import { Swords, RefreshCw } from 'lucide-react';
import SimulationMonitorControl from '../SimulationMonitorControl';

interface ArenaHeaderProps {
  selectedCompetition: string;
  onCompetitionChange: (comp: string) => void;
  competitionOptions: Array<{ value: string; label: string; tag?: string }>;
  hasSimData: boolean;
  isFinished: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

export const ArenaHeader: React.FC<ArenaHeaderProps> = ({
  selectedCompetition,
  onCompetitionChange,
  competitionOptions,
  hasSimData,
  isFinished,
  refreshing,
  onRefresh,
}) => {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        borderRadius: 14,
        border: '1px solid #e2e8f0',
        padding: '20px 24px',
        marginBottom: 20,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 16,
      }}
    >
      <Space align="center" size={14}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: '#fffbeb',
            display: 'grid',
            placeItems: 'center',
            border: '1px solid #fde68a',
          }}
        >
          <Swords size={24} color="#d97706" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: 20, color: '#0f172a' }}>
              天梯对抗竞技场 (Simulation Arena)
            </span>
            {hasSimData && isFinished ? (
              <Tag color="cyan" style={{ fontWeight: 700, margin: 0 }}>
                🏁 已完赛封榜存档
              </Tag>
            ) : hasSimData ? (
              <Tag color="gold" style={{ fontWeight: 700, margin: 0 }}>
                ⚔️ 实时对抗巡检中
              </Tag>
            ) : (
              <Tag color="blue" style={{ fontWeight: 700, margin: 0 }}>
                ⏳ 备战待命中 (未启用巡检)
              </Tag>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
            仿真对抗赛事 ELO 追踪与智能体战力评估
          </div>
        </div>
      </Space>

      <Space size={10} wrap>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', maxWidth: '100%' }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>赛事切换:</span>
          <Select
            value={selectedCompetition}
            onChange={onCompetitionChange}
            style={{ minWidth: 200, maxWidth: 360, flex: 1 }}
            options={competitionOptions}
            showSearch
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </div>
        <SimulationMonitorControl currentCompetition={selectedCompetition} />
        <Button
          icon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />}
          loading={refreshing}
          onClick={onRefresh}
        >
          刷新
        </Button>
      </Space>
    </div>
  );
};

export default ArenaHeader;
