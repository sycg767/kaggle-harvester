import React, { useState } from 'react';
import { AutoComplete, Button, Modal, Space, Tag } from 'antd';
import { Check, Compass, Search, Trophy } from 'lucide-react';
import type { CompetitionInfo, EnteredCompetition, HealthStatus } from '../../api';
import { buildEnteredCompetitionOptions } from '../../competitionOptions';
import DialogTitle from '../DialogTitle';

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

  const activeCompetitionSlug = health?.active_competition?.competition;
  const currentSlug = competitionInfo?.id;

  return (
    <Modal
      className="app-modal competition-switcher-modal"
      closable={false}
      title={(
        <DialogTitle
          icon={<Trophy size={18} color="#007aff" />}
          title="切换主工作区竞赛"
          subtitle="Command Palette"
          onClose={onClose}
        />
      )}
      open={open}
      onCancel={onClose}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#8e8e93', display: 'flex', alignItems: 'center', gap: 6 }}>
            <kbd style={{ padding: '2px 7px', background: 'rgba(0,0,0,0.05)', borderRadius: 5, border: '1px solid rgba(0,0,0,0.08)', fontFamily: 'inherit', fontSize: 11, fontWeight: 500, color: '#48484a' }}>Enter</kbd>
            <span>直接切换</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <kbd style={{ padding: '2px 7px', background: 'rgba(0,0,0,0.05)', borderRadius: 5, border: '1px solid rgba(0,0,0,0.08)', fontFamily: 'inherit', fontSize: 11, fontWeight: 500, color: '#48484a' }}>Esc</kbd>
            <span>退出</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              icon={<Compass size={14} />}
              onClick={() => handleSelect(switcherSearch.trim() || currentSlug || '', true)}
              disabled={!switcherSearch.trim() && !currentSlug}
            >
              前往开源广场
            </Button>
            <Button
              type="primary"
              disabled={!switcherSearch.trim() && !currentSlug}
              onClick={() => handleSelect(switcherSearch.trim() || currentSlug || '')}
            >
              确认切换
            </Button>
          </div>
        </div>
      )}
      width={580}
      destroyOnClose
      zIndex={1250}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: '#636366' }}>
          切换当前浏览器的工作台和代码发现赛事。天梯页独立选择；服务器默认赛事和后台监控配置保持原设置。
        </p>

        <AutoComplete
          style={{ width: '100%' }}
          placeholder="搜索已参加竞赛，或直接输入 Kaggle 竞赛 slug 后回车..."
          options={buildEnteredCompetitionOptions(
            enteredCompetitions,
            [
              activeCompetitionSlug,
              health?.default_competition,
              currentSlug,
            ],
            {
              activeSlug: activeCompetitionSlug,
              currentSlug: currentSlug,
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

        {/* 快速选择列表 */}
        <div className="settings-group">
          <div className="settings-group-header">
            <span>我的参赛清单 ({enteredCompetitions.length})</span>
            {currentSlug && (
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'rgba(0, 122, 255, 0.08)',
                  color: '#007aff',
                  fontSize: 11.5,
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '-0.01em',
                }}
              >
                当前: {currentSlug}
              </span>
            )}
          </div>
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {enteredCompetitions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 13, color: '#8e8e93' }}>
                暂无已参加竞赛，可在上方输入 Kaggle Slug 直接载入
              </div>
            ) : (
              enteredCompetitions.map((c) => {
                const isCurrent = c.id === currentSlug;
                const isActive = c.id === activeCompetitionSlug;
                return (
                  <div
                    key={c.id}
                    onClick={() => handleSelect(c.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: isCurrent ? 'rgba(0, 122, 255, 0.08)' : 'rgba(0, 0, 0, 0.02)',
                      border: isCurrent ? '1px solid rgba(0, 122, 255, 0.25)' : '1px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, marginRight: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13.5, fontWeight: isCurrent ? 600 : 500, color: isCurrent ? '#007aff' : '#1c1c1e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
                          {c.title || c.id}
                        </span>
                        {isActive && (
                          <span className="dialog-status-pill success" style={{ padding: '1px 6px', fontSize: 10 }}>
                            主攻
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: '#8e8e93', fontFamily: 'inherit', letterSpacing: '-0.01em' }}>
                        {c.id}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {isCurrent && <Check size={16} color="#007aff" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default GlobalCompetitionSwitcherModal;
