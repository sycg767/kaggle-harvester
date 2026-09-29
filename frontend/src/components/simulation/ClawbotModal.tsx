import React from 'react';
import { Alert, Button, Card, Col, Modal, Row, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { MessageCircle } from 'lucide-react';
import type { SimulationClawbotTestResult, SimulationMonitorStatus } from '../../types/api';

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
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageCircle size={18} color="#16a34a" />
          <span style={{ fontWeight: 700 }}>微信 ClawBot 智能对战助手</span>
        </div>
      }
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
          我知道了
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

        <Card size="small" style={{ marginBottom: 16, background: '#f8fafc' }}>
          <Row gutter={[12, 10]}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>网关活跃状态</Text>
              <div style={{ marginTop: 2 }}>
                {status?.clawbot?.is_online ? (
                  <Tag color="success" style={{ fontWeight: 700 }}>端口 18789 活跃</Tag>
                ) : status?.clawbot?.configured ? (
                  <Tag color="warning">已配置 · 网关离线</Tag>
                ) : (
                  <Tag color="default">未就绪</Tag>
                )}
              </div>
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>解析大模型引擎</Text>
              <div style={{ marginTop: 2, fontWeight: 700, color: '#0f172a' }}>
                {status?.clawbot?.model || 'deepseek-v4-flash-0731'}
              </div>
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>模型服务商</Text>
              <div style={{ marginTop: 2, color: '#334155' }}>
                {status?.clawbot?.provider || 'TokenRhythm Studio'}
              </div>
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>当前连接网关</Text>
              <div style={{ marginTop: 2, color: '#334155', fontSize: 12, wordBreak: 'break-all' }}>
                {status?.clawbot?.gateway_url || 'http://127.0.0.1:18789'}
              </div>
            </Col>
          </Row>

          {testResult && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: testResult.success ? '#166534' : '#b45309' }}>
                诊断详情：{testResult.message}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {testResult.candidates.map((c) => (
                  <div key={c.target} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, background: '#fff', padding: '3px 8px', borderRadius: 4, border: '1px solid #f1f5f9' }}>
                    <Text code style={{ fontSize: 11 }}>{c.target}</Text>
                    <Tag color={c.reachable ? 'success' : 'default'} style={{ margin: 0, fontSize: 11, padding: '0 4px' }}>
                      {c.detail}
                    </Tag>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Title level={5} style={{ fontSize: 14, marginBottom: 8 }}>
          📱 手机微信常用指令速查
        </Title>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f1f5f9', borderRadius: 6 }}>
            <Space>
              <Tag color="blue" style={{ margin: 0, fontWeight: 700 }}>战况 / 查战况</Tag>
              <Text style={{ fontSize: 13 }}>获取双 Agent 实时积分、排位、胜率及最新一局对战</Text>
            </Space>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f1f5f9', borderRadius: 6 }}>
            <Space>
              <Tag color="gold" style={{ margin: 0, fontWeight: 700 }}>分数 / 排名</Tag>
              <Text style={{ fontSize: 13 }}>快速汇总金银铜牌线切分点与我方安全垫</Text>
            </Space>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f1f5f9', borderRadius: 6 }}>
            <Space>
              <Tag color="purple" style={{ margin: 0, fontWeight: 700 }}>刷新 / 立即检查</Tag>
              <Text style={{ fontSize: 13 }}>触发后端立刻向 Kaggle 同步一次最新对局数据</Text>
            </Space>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ClawbotModal;
