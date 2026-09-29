import React from 'react';
import { Card, Form, Space, Switch } from 'antd';
import { AlertTriangle, Archive, Swords, TrendingUp } from 'lucide-react';

export const EventSubscriptionTab: React.FC = () => {
  return (
    <Card size="small" style={{ borderRadius: 10, border: '1px solid #e2e8f0' }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 14 }}>
        订阅与触发策略
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Event 1: Score */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
          <Space size={12} align="center">
            <div style={{ width: 34, height: 34, borderRadius: 8, background: '#eff6ff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <TrendingUp size={18} color="#2563eb" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>竞赛提交产生新出分</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>监控器检测到提交从 Pending 变为 Scored，立即解析 Public Leaderboard 分数并推送通知</div>
            </div>
          </Space>
          <Form.Item name="notify_on_score" valuePropName="checked" noStyle>
            <Switch checkedChildren="开启" unCheckedChildren="关闭" defaultChecked />
          </Form.Item>
        </div>

        {/* Event 2: Archive */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
          <Space size={12} align="center">
            <div style={{ width: 34, height: 34, borderRadius: 8, background: '#f5f3ff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Archive size={18} color="#7c3aed" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>高分 Kernel 自动归档完成</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>定时自动归档命中设定的门槛分数并成功下载 Notebook 源代码与输出时触发推送</div>
            </div>
          </Space>
          <Form.Item name="notify_on_archive" valuePropName="checked" noStyle>
            <Switch checkedChildren="开启" unCheckedChildren="关闭" defaultChecked />
          </Form.Item>
        </div>

        {/* Event 3: Pokemon Simulation Battles */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
          <Space size={12} align="center">
            <div style={{ width: 34, height: 34, borderRadius: 8, background: '#fef3c7', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Swords size={18} color="#d97706" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>宝可梦模拟对战与天梯战报</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>双 Agent 新增对局胜负、排位变动与奖牌线升降级时推送（可单独关闭以避免群聊刷屏）</div>
            </div>
          </Space>
          <Form.Item name="notify_on_simulation" valuePropName="checked" noStyle>
            <Switch checkedChildren="开启" unCheckedChildren="关闭" defaultChecked />
          </Form.Item>
        </div>

        {/* Event 4: Failure alert */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
          <Space size={12} align="center">
            <div style={{ width: 34, height: 34, borderRadius: 8, background: '#fff1f2', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <AlertTriangle size={18} color="#e11d48" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>检查失败与重试告警</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>当 Kaggle API 凭据失效、网络受阻或归档过程发生不可逆错误时即时告警</div>
            </div>
          </Space>
          <Form.Item name="notify_on_failure" valuePropName="checked" noStyle>
            <Switch checkedChildren="开启" unCheckedChildren="关闭" defaultChecked />
          </Form.Item>
        </div>
      </div>
    </Card>
  );
};

export default EventSubscriptionTab;
