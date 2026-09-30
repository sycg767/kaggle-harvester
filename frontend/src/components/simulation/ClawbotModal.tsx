import React from 'react';
import { Alert, Button, Descriptions, Modal, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { MessageCircle } from 'lucide-react';
import type { SimulationClawbotTestResult, SimulationMonitorStatus } from '../../types/api';
import DialogTitle from '../DialogTitle';

interface ClawbotModalProps {
  open: boolean; onClose: () => void; status?: SimulationMonitorStatus | null;
  testing: boolean; testResult: SimulationClawbotTestResult | null; onTest: () => Promise<void>;
}
const stateTag = (value: boolean | null | undefined, yes = '正常', no = '异常') =>
  <Tag color={value === true ? 'success' : value === false ? 'warning' : 'default'}>{value === true ? yes : value === false ? no : '未验证'}</Tag>;

export const ClawbotModal: React.FC<ClawbotModalProps> = ({ open, onClose, status, testing, testResult, onTest }) => {
  // A manual probe carries its contemporaneous host snapshot, avoiding a mix of
  // fresh TCP diagnostics and a previous monitor response.
  const tested = testResult?.status;
  const current = status?.clawbot;
  const bot = tested && (!current?.checked_at || Date.parse(tested.checked_at || '') >= Date.parse(current.checked_at)) ? tested : current;
  const fresh = bot?.status_source === 'host_snapshot' && !!bot.checked_at && Date.now() - Date.parse(bot.checked_at) <= 90000;
  const observed = (value: boolean | null | undefined) => fresh ? value : null;
  return <Modal className="app-modal" closable={false} open={open} onCancel={onClose} width={560} zIndex={1100}
    title={<DialogTitle icon={<MessageCircle size={17} color="#16a34a" />} title="微信助手状态" subtitle="宿主机状态与应用连接诊断" onClose={onClose} />}
    footer={<Space><Button icon={<ReloadOutlined />} loading={testing} onClick={() => void onTest()}>刷新状态并测试连接</Button><Button type="primary" onClick={onClose}>关闭</Button></Space>}>
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      {(!fresh || bot?.error) && <Alert type="warning" showIcon message={bot?.error || '状态暂未更新，请稍后刷新'} />}
      <Descriptions column={1} size="small" bordered items={[
        { key: 'gateway', label: '宿主机网关', children: stateTag(observed(bot?.gateway_ok), '运行中', '未运行') },
        { key: 'wechat', label: '微信插件', children: <>{stateTag(observed(bot?.wechat_running), '运行中', '未运行')}{observed(bot?.wechat_configured) === false && <Typography.Text type="secondary">未配置</Typography.Text>}</> },
        { key: 'api', label: '战报 API', children: stateTag(observed(bot?.business_api_ok), '可用', '不可用') },
        { key: 'delivery', label: '主动推送', children: stateTag(observed(bot?.delivery_configured), '已配置收件人', '未配置收件人') },
        { key: 'model', label: '模型', children: bot?.model || '未记录' },
        { key: 'time', label: '采集时间', children: bot?.checked_at ? new Date(bot.checked_at).toLocaleString() : '暂无快照' },
      ]} />
      {testResult && <div><Typography.Text strong>{testResult.message}</Typography.Text>
        <details style={{ marginTop: 8 }}><summary>连接诊断详情</summary>{testResult.candidates.map(item => <div key={item.target} style={{ padding: '6px 0', overflowWrap: 'anywhere' }}><Typography.Text code>{item.target}</Typography.Text> {stateTag(item.reachable, '可达', '不可达')}</div>)}</details>
      </div>}
      <div><Typography.Text strong>微信指令</Typography.Text><p style={{ marginBottom: 4 }}>战况 / 分数 / 排名：读取最近成功同步的战报。</p><p style={{ marginBottom: 4 }}>刷新 / 立即检查：触发一次真实同步，完成后返回战报；失败会明确提示。</p><Typography.Text type="secondary">需要宿主机微信插件与指令服务完成配置。上面的按钮只刷新诊断，不发送微信消息。</Typography.Text></div>
    </Space>
  </Modal>;
};
export default ClawbotModal;
