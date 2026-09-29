import React from 'react';
import { App, Button, Descriptions, Drawer, Space, Tag } from 'antd';
import { Clipboard, LogOut } from 'lucide-react';
import { apiAuth, type HealthStatus } from '../../api';
import { copyDiagnostics, formatBytes } from './layoutUtils';

interface RuntimeDiagnosticsDrawerProps {
  open: boolean;
  health: HealthStatus | null;
  onClose: () => void;
  onForgetApiKey: () => void;
}

export const RuntimeDiagnosticsDrawer: React.FC<RuntimeDiagnosticsDrawerProps> = ({
  open,
  health,
  onClose,
  onForgetApiKey,
}) => {
  const { message } = App.useApp();

  return (
    <Drawer
      title="运行概况与系统诊断"
      placement="right"
      open={open}
      onClose={onClose}
      width={480}
      extra={
        <Button
          type="text"
          icon={<Clipboard size={16} />}
          onClick={() => {
            void copyDiagnostics(health);
            message.success('已复制诊断报告到剪贴板');
          }}
        >
          复制报告
        </Button>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Descriptions title="服务健康度" bordered size="small" column={1}>
          <Descriptions.Item label="服务名称">{health?.service || '—'}</Descriptions.Item>
          <Descriptions.Item label="系统版本">{health?.version || '—'}</Descriptions.Item>
          <Descriptions.Item label="Kaggle CLI">
            <Tag color={health?.kaggle_cli ? 'success' : 'error'}>
              {health?.kaggle_cli ? '正常' : '未安装或异常'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Kaggle 凭据">
            <Tag color={health?.token_configured ? 'success' : 'error'}>
              {health?.token_configured ? '已配置' : '未配置'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="UTF-8 门禁">
            <Tag color={health?.utf8_wrapper_exists ? 'success' : 'warning'}>
              {health?.utf8_wrapper_exists ? '已就绪' : '缺失'}
            </Tag>
          </Descriptions.Item>
        </Descriptions>

        {health?.archive && (
          <Descriptions title="本地存储概况" bordered size="small" column={1}>
            <Descriptions.Item label="归档总版本数">
              {health.archive.total_archives}
            </Descriptions.Item>
            <Descriptions.Item label="唯一 Kernel 数">
              {health.archive.unique_kernels}
            </Descriptions.Item>
            <Descriptions.Item label="磁盘剩余可用">
              <span style={{ color: health.archive.low_disk_space ? '#ef4444' : 'inherit', fontWeight: 600 }}>
                {formatBytes(health.archive.disk_free_bytes)}
              </span>
            </Descriptions.Item>
          </Descriptions>
        )}

        {Boolean(apiAuth.getKey()) && (
          <div style={{ paddingTop: 8 }}>
            <Button danger icon={<LogOut size={16} />} onClick={onForgetApiKey} block>
              清除当前浏览器保存的 API 访问密钥
            </Button>
          </div>
        )}
      </Space>
    </Drawer>
  );
};

export default RuntimeDiagnosticsDrawer;
