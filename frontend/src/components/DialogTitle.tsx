import React from 'react';
import { Button } from 'antd';
import { X } from 'lucide-react';

interface DialogTitleProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  extra?: React.ReactNode;
  children?: React.ReactNode;
  onClose: () => void;
  disabled?: boolean;
}

const DialogTitle: React.FC<DialogTitleProps> = ({
  icon,
  title,
  subtitle,
  badge,
  extra,
  children,
  onClose,
  disabled = false,
}) => {
  const isStructured = title !== undefined || icon !== undefined || subtitle !== undefined;

  return (
    <div className="dialog-title-row">
      {isStructured ? (
        <div className="dialog-title-structured">
          {icon && <div className="dialog-title-icon-tile">{icon}</div>}
          <div className="dialog-title-text-group">
            <div className="dialog-title-main">
              <span>{title}</span>
              {badge}
            </div>
            {subtitle && <div className="dialog-title-subtitle">{subtitle}</div>}
          </div>
        </div>
      ) : (
        <div className="dialog-title-content">{children}</div>
      )}
      {extra && <div className="dialog-title-extra">{extra}</div>}
      <Button
        type="text"
        className="dialog-title-close"
        icon={<X size={17} />}
        aria-label="关闭"
        disabled={disabled}
        onClick={onClose}
      />
    </div>
  );
};

export default DialogTitle;

