import React from 'react';
import {
  Button,
  Col,
  Form,
  type FormInstance,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import type { AutoArchiveConfig } from '../../api';

const { Text } = Typography;

interface AutoArchiveConfigFormProps {
  form: FormInstance<AutoArchiveConfig>;
  disabled: boolean;
  competitionSelectOptions: Array<{ value: string; label: React.ReactNode }>;
  competitionTitleById: Map<string, string>;
  enteredLoading: boolean;
  enteredError: string | null;
  onRefreshCompetitions: () => void;
  currentCompetition?: string;
}

export const AutoArchiveConfigForm: React.FC<AutoArchiveConfigFormProps> = ({
  form,
  disabled,
  competitionSelectOptions,
  competitionTitleById,
  enteredLoading,
  enteredError,
  onRefreshCompetitions,
  currentCompetition,
}) => {
  return (
    <Form<AutoArchiveConfig>
      form={form}
      layout="vertical"
      disabled={disabled}
      initialValues={{
        enabled: false,
        competitions: currentCompetition ? [currentCompetition] : [],
        score_thresholds: {},
        interval_minutes: 30,
        include_outputs: false,
        score_direction: 'auto',
      }}
    >
      <Row gutter={16}>
        <Col xs={24} sm={16}>
          <Form.Item
            name="competitions"
            label="监控竞赛"
            rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一个竞赛' }]}
            extra={
              enteredError
                ? `已参加列表读取失败：${enteredError}。仍可选择当前页竞赛或已保存项。`
                : (
                  <span>
                    已参加竞赛 · 可多选
                    {' · '}
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: 'auto' }}
                      loading={enteredLoading}
                      onClick={onRefreshCompetitions}
                    >
                      刷新
                    </Button>
                  </span>
                )
            }
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              loading={enteredLoading}
              optionFilterProp="label"
              placeholder="选择竞赛"
              aria-label="自动归档监控竞赛"
              options={competitionSelectOptions}
              maxTagCount="responsive"
              maxTagTextLength={28}
              listHeight={280}
              popupMatchSelectWidth={false}
              styles={{ popup: { root: { minWidth: 320 } } }}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item name="interval_minutes" label="刷新间隔" rules={[{ required: true }]}>
            <Select aria-label="自动归档刷新间隔" options={[
              { value: 1, label: '1 分钟' },
              { value: 2, label: '2 分钟' },
              { value: 5, label: '5 分钟' },
              { value: 10, label: '10 分钟' },
              { value: 30, label: '30 分钟' },
              { value: 60, label: '1 小时' },
              { value: 180, label: '3 小时' },
              { value: 360, label: '6 小时' },
            ]} />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item noStyle shouldUpdate={(prev, next) => prev.competitions !== next.competitions}>
        {() => {
          const competitions = (form.getFieldValue('competitions') as string[] | undefined) || [];
          if (!competitions.length) return null;
          return (
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                各竞赛分数阈值（启用时必填）
              </Text>
              <Row gutter={[16, 12]}>
                {competitions.map((slug) => (
                  <Col xs={24} sm={12} key={slug}>
                    <Form.Item
                      name={['score_thresholds', slug]}
                      label={competitionTitleById.get(slug) || slug}
                      rules={[{ required: true, message: `请设置阈值` }]}
                      style={{ marginBottom: 4 }}
                      extra={<Text type="secondary" style={{ fontSize: 12 }}>{slug}</Text>}
                    >
                      <InputNumber
                        aria-label={`${slug} 分数阈值`}
                        precision={6}
                        style={{ width: '100%' }}
                        placeholder="输入本赛事的目标公开分数"
                      />
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </div>
          );
        }}
      </Form.Item>
      <Space size="large" wrap>
        <Form.Item name="enabled" valuePropName="checked" label="定时任务" style={{ marginBottom: 16 }}>
          <Switch checkedChildren="已启用" unCheckedChildren="已关闭" />
        </Form.Item>
        <Form.Item name="include_outputs" valuePropName="checked" label="归档内容" style={{ marginBottom: 16 }}>
          <Switch checkedChildren="包含输出" unCheckedChildren="仅源码" />
        </Form.Item>
      </Space>
      <Form.Item
        name="score_direction"
        label="分数方向"
        extra="所有选中赛事共用频率和输出策略。方向不一致时请选择自动识别，各赛事分别判断；识别失败会停止该赛事。"
      >
        <Select options={[
          { value: 'auto', label: '自动识别（仅接受可靠来源）' },
          { value: 'minimize', label: '越低越好' },
          { value: 'maximize', label: '越高越好' },
        ]} />
      </Form.Item>
    </Form>
  );
};

export default AutoArchiveConfigForm;
