import React from 'react';
import { Tag, Select, Button } from 'antd';
import { Swords, RefreshCw, CheckCircle2, Activity, Clock } from 'lucide-react';
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
    <div className="arena-header-banner">
      <div className="arena-header-main">
        <div className="arena-header-icon-tile">
          <Swords size={20} color="#007aff" />
        </div>
        <div className="arena-header-text-group">
          <div className="arena-header-title-row">
            <h1 className="arena-header-title">天梯对抗</h1>
            {hasSimData && isFinished ? (
              <Tag color="cyan" className="arena-status-tag">
                <CheckCircle2 size={12} />
                <span>已完赛</span>
              </Tag>
            ) : hasSimData ? (
              <Tag color="gold" className="arena-status-tag">
                <Activity size={12} />
                <span>实时</span>
              </Tag>
            ) : (
              <Tag color="blue" className="arena-status-tag">
                <Clock size={12} />
                <span>待命</span>
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
          <span className="arena-header-select-label">赛事:</span>
          <Select
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
          <Button
            icon={<RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />}
            loading={refreshing}
            onClick={onRefresh}
            className="arena-refresh-btn"
            aria-label="刷新"
          >
            <span>刷新</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ArenaHeader;
