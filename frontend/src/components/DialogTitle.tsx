import React from 'react';
import { Button } from 'antd';
import { X } from 'lucide-react';

interface DialogTitleProps {
  children: React.ReactNode;
  onClose: () => void;
  disabled?: boolean;
}

const DialogTitle: React.FC<DialogTitleProps> = ({ children, onClose, disabled = false }) => (
  <div className="dialog-title-row">
    <div className="dialog-title-content">{children}</div>
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

export default DialogTitle;

