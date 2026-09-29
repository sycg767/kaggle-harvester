import React from 'react';
import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Tag,
  message,
  type FormInstance,
} from 'antd';
import { SaveOutlined, TagOutlined } from '@ant-design/icons';
import type { SimulationMonitorConfig } from '../../types/api';

export interface AvailableSubmissionItem {
  submission_id: number;
  description: string;
  file_name: string;
  date: string;
  status: string;
  public_score?: number | null;
  team_name?: string;
}

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  form: FormInstance<SimulationMonitorConfig>;
  onFinish: (values: SimulationMonitorConfig) => Promise<void>;
  saving: boolean;
  targetCompetition: string;
  loadingSubmissions: boolean;
  availableSubmissions: AvailableSubmissionItem[];
  watchedTargetIds: any[];
  submissionAliases: Record<string, string>;
  setSubmissionAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  fetchAvailableSubmissions: (comp?: string) => Promise<void>;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  open,
  onClose,
  form,
  onFinish,
  saving,
  targetCompetition,
  loadingSubmissions,
  availableSubmissions,
  watchedTargetIds,
  submissionAliases,
  setSubmissionAliases,
  fetchAvailableSubmissions,
}) => {
  return (
    <Drawer
      title="模拟对战监控设置"
      placement="right"
      width="min(420px, 100vw)"
      open={open}
      zIndex={1200}
      forceRender
      onClose={onClose}
      extra={
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={() => form.submit()}
        >
          保存配置
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          enabled: true,
          competition: targetCompetition,
          interval_minutes: 10,
          bronze_percentile: 0.10,
          target_submission_ids: [],
          notify_on_new_matches: true,
          notify_on_medal_change: true,
        }}
      >
        <Form.Item
          name="enabled"
          label="启用后台定时对战监控"
          valuePropName="checked"
        >
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>

        <Form.Item
          name="competition"
          label="监控竞赛 Slug"
          rules={[{ required: true, message: '请输入竞赛 Slug' }]}
        >
          <Input
            placeholder={targetCompetition}
            onChange={(e) => {
              const val = e.target.value?.trim();
              if (val) void fetchAvailableSubmissions(val);
            }}
          />
        </Form.Item>

        <Form.Item
          name="interval_minutes"
          label="轮询检查间隔 (分钟)"
          rules={[{ required: true }]}
        >
          <InputNumber min={2} max={1440} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="bronze_percentile"
          label="铜牌线切分比例 (例如 0.10 代表前 10%)"
          rules={[{ required: true }]}
        >
          <InputNumber min={0.01} max={0.50} step={0.01} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="target_submission_ids"
          label={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span>🎯 监控的目标 Agent 提交 ID (支持团队成员提交)</span>
            </div>
          }
          tooltip="可直接下拉勾选团队提交，或直接输入/粘贴 8 位 Submission ID"
        >
          <Select
            mode="tags"
            placeholder={loadingSubmissions ? '正在同步可用提交列表...' : '点击下拉勾选，或直接输入 8 位提交 ID'}
            tokenSeparators={[',', ' ']}
            loading={loadingSubmissions}
            style={{ width: '100%' }}
            options={availableSubmissions.map((sub) => {
              const desc = sub.description || sub.file_name || `提交 #${sub.submission_id}`;
              const scoreText = sub.public_score !== undefined && sub.public_score !== null ? ` · ${sub.public_score.toFixed(1)}分` : '';
              return {
                value: sub.submission_id,
                label: `#${sub.submission_id} · ${desc}${scoreText}`,
              };
            })}
          />
        </Form.Item>

        <div style={{ marginTop: -14, marginBottom: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button
            size="small"
            type="dashed"
            loading={loadingSubmissions}
            onClick={() => {
              if (availableSubmissions.length > 0) {
                const latestTwo = availableSubmissions
                  .filter((s) => s.status?.toLowerCase().includes('complete') || s.status?.toLowerCase().includes('success'))
                  .slice(0, 2)
                  .map((s) => s.submission_id);
                form.setFieldsValue({
                  target_submission_ids: latestTwo.length > 0 ? latestTwo : availableSubmissions.slice(0, 2).map((s) => s.submission_id),
                });
              } else {
                void fetchAvailableSubmissions().then(() => {
                  message.info('正在拉取提交列表，请再次点击');
                });
              }
            }}
          >
            ⚡ 快捷填入最新 2 个有效提交
          </Button>
          <Button
            size="small"
            type="text"
            onClick={() => form.setFieldsValue({ target_submission_ids: [] })}
          >
            清空 (全自动模式)
          </Button>
        </div>

        {/* Agent 自定义别名配置区 */}
        {watchedTargetIds && watchedTargetIds.length > 0 && (
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <TagOutlined style={{ color: '#2563eb' }} />
              <span>Agent 自定义别名 / 代号 (如 p32, p46)</span>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
              为选中的提交设置容易辨识的代号，将同步应用于天梯卡片、折线走势图及微信机器人战报：
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {watchedTargetIds.map((idVal: any, idx: number) => {
                const subId = Number(idVal);
                const subObj = availableSubmissions.find((s) => s.submission_id === subId);
                const defaultLabel = subObj ? (subObj.description || subObj.file_name) : '';
                const idStr = String(subId);
                const currentAlias = submissionAliases[idStr] || '';

                return (
                  <div
                    key={idStr}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      background: '#ffffff',
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Tag color="blue" style={{ margin: 0, fontSize: 11, fontWeight: 700 }}>#{subId}</Tag>
                        <span
                          style={{
                            fontSize: 12,
                            color: '#334155',
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={defaultLabel || `Agent ${idx + 1}`}
                        >
                          {defaultLabel || `Agent ${idx + 1}`}
                        </span>
                      </div>
                    </div>
                    <Input
                      size="small"
                      placeholder="别名 (如 p46)"
                      value={currentAlias}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSubmissionAliases((prev) => ({ ...prev, [idStr]: val }));
                      }}
                      style={{ width: 120 }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
          <Form.Item
            name="notify_on_new_matches"
            label="新增对局战报时发送通知"
            valuePropName="checked"
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>

          <Form.Item
            name="notify_on_medal_change"
            label="奖牌状态升降级变动时发送通知"
            valuePropName="checked"
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
        </div>
      </Form>
    </Drawer>
  );
};

export default SettingsDrawer;
