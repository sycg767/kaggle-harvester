import React, { useState } from 'react';
import { App as AntApp, Tooltip } from 'antd';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  value: string;
  label?: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({ value, label = '复制内容' }) => {
  const { message } = AntApp.useApp();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      message.error('复制失败，请检查浏览器权限');
    }
  };

  return (
    <Tooltip title={copied ? '已复制' : label}>
      <button type="button" className="copy-button" aria-label={copied ? '已复制' : label} onClick={() => void copy()}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </Tooltip>
  );
};

export default CopyButton;
