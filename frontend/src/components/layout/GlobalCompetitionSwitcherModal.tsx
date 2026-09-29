import React, { useState } from 'react';
import { AutoComplete, Button, Modal, Space, Typography } from 'antd';
import { Search, Trophy } from 'lucide-react';
import type { CompetitionInfo, EnteredCompetition, HealthStatus } from '../../api';
import { buildEnteredCompetitionOptions } from '../../competitionOptions';
import DialogTitle from '../DialogTitle';

const { Text } = Typography;

interface GlobalCompetitionSwitcherModalProps {
  open: boolean;
  competitionInfo: CompetitionInfo | null;
  enteredCompetitions: EnteredCompetition[];
  health: HealthStatus | null;
  onClose: () => void;
  onSelectCompetition: (slug: string, navigateToKernels?: boolean) => void;
}

export const GlobalCompetitionSwitcherModal: React.FC<GlobalCompetitionSwitcherModalProps> = ({
  open,
  competitionInfo,
  enteredCompetitions,
  health,
  onClose,
  onSelectCompetition,
}) => {
  const [switcherSearch, setSwitcherSearch] = useState('');

  const handleSelect = (slug: string, navigateToKernels = false) => {
    onSelectCompetition(slug, navigateToKernels);
    setSwitcherSearch('');
  };

  return (
    <Modal
      title={(
        <DialogTitle onClose={onClose}>
          <Space size={8} align="center">
            <Trophy size={18} color="#1677ff" />
            <span style={{ fontWeight: 600, fontSize: 16 }}>切换主工作区竞赛 (Command Palette)</span>
          </Space>
        </DialogTitle>
      )}
      open={open}
      onCancel={onClose}
      footer={null}
      width={620}
      destroyOnClose
      zIndex={1250}
    >
      <div style={{ paddingTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
          全局切换当前主工作区竞赛，工作台、开源代码广场、天梯对抗将同步联动：
        </Text>
        <AutoComplete
          style={{ width: '100%' }}
          size="large"
          placeholder="搜索已参加竞赛，或直接输入 Kaggle 竞赛 slug 后回车..."
          options={buildEnteredCompetitionOptions(
            enteredCompetitions,
            [
              health?.active_competition?.competition,
              health?.default_competition,
              competitionInfo?.id,
            ],
            {
              activeSlug: health?.active_competition?.competition,
              currentSlug: competitionInfo?.id,
            }
          )}
          filterOption={(inputValue, option) =>
            (option?.label?.toString() || '').toLowerCase().includes(inputValue.toLowerCase()) ||
            (option?.value?.toString() || '').toLowerCase().includes(inputValue.toLowerCase())
          }
          onSelect={(value) => handleSelect(String(value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && switcherSearch.trim()) {
              handleSelect(switcherSearch.trim());
            }
          }}
          onChange={setSwitcherSearch}
          autoFocus
        />
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>快速切换竞赛：</div>
          <Space wrap size={6}>
            {enteredCompetitions.slice(0, 6).map((c) => (
              <Button
                key={c.id}
                size="small"
                type={c.id === competitionInfo?.id ? 'primary' : 'default'}
                onClick={() => handleSelect(c.id)}
                style={{ borderRadius: 6, fontSize: 12 }}
              >
                {c.title ? (c.title.length > 18 ? `${c.title.slice(0, 18)}…` : c.title) : c.id}
              </Button>
            ))}
          </Space>
        </div>
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button
            icon={<Search size={14} />}
            onClick={() => handleSelect(switcherSearch.trim() || competitionInfo?.id || '', true)}
          >
            前往该竞赛开源广场
          </Button>
          <Button
            type="primary"
            disabled={!switcherSearch.trim() && !competitionInfo?.id}
            onClick={() => handleSelect(switcherSearch.trim() || competitionInfo?.id || '')}
          >
            确认切换
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default GlobalCompetitionSwitcherModal;
