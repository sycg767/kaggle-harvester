import React from 'react';
import { Alert, Button, Col, Modal, Row, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { MessageCircle, Smartphone } from 'lucide-react';
import type { SimulationClawbotTestResult, SimulationMonitorStatus } from '../../types/api';
import DialogTitle from '../DialogTitle';

const { Text, Title } = Typography;

interface ClawbotModalProps {
  open: boolean;
  onClose: () => void;
  status?: SimulationMonitorStatus | null;
  testing: boolean;
  testResult: SimulationClawbotTestResult | null;
  onTest: () => Promise<void>;
}

export const ClawbotModal: React.FC<ClawbotModalProps> = ({
  open,
  onClose,
  status,
  testing,
  testResult,
  onTest,
}) => {
  return (
    <Modal
      className="app-modal"
      closable={false}
      title={(
        <DialogTitle
          icon={<MessageCircle size={17} color="#16a34a" />}
          title="微信 ClawBot 智能对战助手"
          subtitle="大模型对抗解析与移动端即时指令服务"
          onClose={onClose}
        />
      )}
      open={open}
      onCancel={onClose}
      width={560}
      zIndex={1100}
      footer={[
        <Button
          key="test"
          icon={<ReloadOutlined spin={testing} />}
          loading={testing}
          onClick={() => void onTest()}
        >
          探测网关连通性
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      <div style={{ paddingTop: 8 }}>
        <Alert
          message={
            status?.clawbot?.is_online
              ? '微信智能体双向交互已就绪'
              : status?.clawbot?.configured
              ? '微信智能体已配置，但网关离线'
              : '微信智能体未就绪'
          }
          description={
            status?.clawbot?.is_online
              ? '您可以在手机微信中随时发送指令给当前机器人，直接获取最新天梯战报与排名数据，或触发后台实时刷新。'
              : status?.clawbot?.configured
              ? '已读取到 LLM 配置文件，但当前未探测到正在运行的 OpenClaw 网关（端口 18789）。若在 Docker 中运行，请确保已配置 OPENCLAW_GATEWAY_URL。'
              : '未检测到 OpenClaw 配置文件或环境变量。请在 .env.deploy 中配置 OPENCLAW_LLM_API_KEY 与 OPENCLAW_GATEWAY_URL。'
          }
          type={status?.clawbot?.is_online ? 'success' : status?.clawbot?.configured ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
        />

        <div className="settings-group" style={{ marginBottom: 16 }}>
          <div className="settings-group-header">
            <span>网关与大模型引擎配置</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <span className="settings-row-title">网关活跃状态</span>
              <span className="settings-row-desc">默认本地端口 18789</span>
            </div>
            <div className="settings-row-control">
              {status?.clawbot?.is_online ? (
                <span className="dialog-status-pill is-success">端口 18789 活跃</span>
              ) : status?.clawbot?.configured ? (
                <span className="dialog-status-pill is-warning">已配置 · 网关离线</span>
              ) : (
                <span className="dialog-status-pill is-default">未就绪</span>
              )}
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <span className="settings-row-title">解析大模型引擎</span>
              <span className="settings-row-desc">服务商: {status?.clawbot?.provider || 'TokenRhythm Studio'}</span>
            </div>
            <div className="settings-row-control" style={{ fontWeight: 600, fontSize: 13 }}>
              {status?.clawbot?.model || 'deepseek-v4-flash-0731'}
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <span className="settings-row-title">当前连接网关</span>
              <span className="settings-row-desc" style={{ wordBreak: 'break-all' }}>
                {status?.clawbot?.gateway_url || 'http://127.0.0.1:18789'}
              </span>
            </div>
          </div>

          {testResult && (
            <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(60, 60, 67, 0.08)', background: '#ffffff' }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 8, color: testResult.success ? '#059669' : '#d97706' }}>
                诊断详情：{testResult.message}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {testResult.candidates.map((c) => (
                  <div key={c.target} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, background: '#f8fafc', padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(60, 60, 67, 0.08)' }}>
                    <Text code style={{ fontSize: 11.5 }}>{c.target}</Text>
                    <Tag color={c.reachable ? 'success' : 'default'} style={{ margin: 0, fontSize: 11 }}>
                      {c.detail}
                    </Tag>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="settings-group">
          <div className="settings-group-header">
            <Space size={6}>
              <Smartphone size={13} color="#007aff" />
              <span>手机微信常用指令速查</span>
            </Space>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <Tag color="blue" style={{ width: 'fit-content', fontWeight: 600, margin: 0 }}>战况 / 查战况</Tag>
              <span className="settings-row-desc" style={{ marginTop: 4 }}>获取双 Agent 实时积分、排位、胜率及最新一局对战</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <Tag color="gold" style={{ width: 'fit-content', fontWeight: 600, margin: 0 }}>分数 / 排名</Tag>
              <span className="settings-row-desc" style={{ marginTop: 4 }}>快速汇总金银铜牌线切分点与我方安全垫</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <Tag color="purple" style={{ width: 'fit-content', fontWeight: 600, margin: 0 }}>刷新 / 立即检查</Tag>
              <span className="settings-row-desc" style={{ marginTop: 4 }}>触发后端立刻向 Kaggle 同步一次最新对局数据</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ClawbotModal;
