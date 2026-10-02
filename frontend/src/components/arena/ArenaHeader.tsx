import React from 'react';
import { Tag, Select } from 'antd';
import { Swords, CheckCircle2, Activity, Clock } from 'lucide-react';
import SimulationMonitorControl from '../SimulationMonitorControl';

interface ArenaHeaderProps {
  selectedCompetition: string;
  onCompetitionChange: (comp: string) => void;
  competitionOptions: Array<{ value: string; label: string; tag?: string }>;
  hasSimData: boolean;
  isFinished: boolean;
  isHistorical: boolean;
}

export const ArenaHeader: React.FC<ArenaHeaderProps> = ({
  selectedCompetition,
  onCompetitionChange,
  competitionOptions,
  hasSimData,
  isFinished,
  isHistorical,
}) => {
  return (
    <div className="arena-header-banner">
      <div className="arena-header-main">
        <div className="arena-header-icon-tile">
          <Swords size={20} color="#007aff" />
        </div>
        <div className="arena-header-text-group">
          <div className="arena-header-title-row">
            <h1 className="arena-header-title">天梯对抗</h1>
            {isHistorical ? (
              <Tag color="cyan" className="arena-status-tag">
                <Clock size={12} />
                <span>历史快照</span>
              </Tag>
            ) : isFinished ? (
              <Tag color="cyan" className="arena-status-tag">
                <CheckCircle2 size={12} />
                <span>赛事已截止</span>
              </Tag>
            ) : hasSimData ? (
              <Tag color="gold" className="arena-status-tag">
                <Activity size={12} />
                <span>采集快照</span>
              </Tag>
            ) : (
              <Tag color="blue" className="arena-status-tag">
                <Clock size={12} />
                <span>暂无数据</span>
              </Tag>
            )}
          </div>
          <div className="arena-header-subtitle">
            Simulation Arena · ELO 追踪与智能体战力评估
          </div>
        </div>
      </div>

      <div className="arena-header-controls">
        <div className="arena-header-select-group">
          <span className="arena-header-select-label">查看赛事:</span>
          <Select
            aria-label="查看赛事（仅天梯页）"
            value={selectedCompetition}
            onChange={onCompetitionChange}
            className="arena-header-select"
            options={competitionOptions}
            showSearch
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </div>
        <div className="arena-header-actions">
          <SimulationMonitorControl currentCompetition={selectedCompetition} buttonText="天梯对战监控" />
        </div>
      </div>
    </div>
  );
};

export default ArenaHeader;
