import React from 'react';
import { Drawer, Space } from 'antd';
import kaggleLogo from '../../assets/kaggle-logo.svg';

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
  renderNavigation: () => React.ReactNode;
  renderArchiveSummary: () => React.ReactNode;
}

export const MobileNavDrawer: React.FC<MobileNavDrawerProps> = ({
  open,
  onClose,
  renderNavigation,
  renderArchiveSummary,
}) => {
  return (
    <Drawer
      className="mobile-nav-drawer"
      title={(
        <Space align="center" size={8}>
          <span className="newapi-brand-mark" style={{ width: 36, height: 16 }}>
            <img src={kaggleLogo} alt="Kaggle" style={{ width: 36, height: 14 }} />
          </span>
          <span style={{ fontWeight: 800, fontSize: 15 }}>Harvester 导航</span>
        </Space>
      )}
      placement="left"
      width={275}
      open={open}
      onClose={onClose}
      styles={{
        body: {
          padding: '12px 10px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1 }}>
          {renderNavigation()}
        </div>
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          {renderArchiveSummary()}
        </div>
      </div>
    </Drawer>
  );
};

export default MobileNavDrawer;
