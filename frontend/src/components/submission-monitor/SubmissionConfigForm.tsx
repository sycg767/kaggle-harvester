import React from 'react';
import {
  Button,
  Col,
  Form,
  type FormInstance,
  Input,
  Row,
  Select,
  Switch,
} from 'antd';
import type { SubmissionMonitorConfig } from '../../api';

interface SubmissionConfigFormProps {
  form: FormInstance<SubmissionMonitorConfig>;
  disabled: boolean;
  competitionSelectOptions: Array<{ value: string; label: React.ReactNode }>;
  enteredLoading: boolean;
  enteredError: string | null;
  onRefreshCompetitions: () => void;
  currentCompetition?: string;
}

export const SubmissionConfigForm: React.FC<SubmissionConfigFormProps> = ({
  form,
  disabled,
  competitionSelectOptions,
  enteredLoading,
  enteredError,
  onRefreshCompetitions,
  currentCompetition,
}) => {
  return (
    <Form<SubmissionMonitorConfig>
      form={form}
      layout="vertical"
      disabled={disabled}
      initialValues={{
        enabled: false,
        competitions: currentCompetition ? [currentCompetition] : [],
        interval_minutes: 5,
        page_size: 10,
        description_prefix: '',
        score_source: 'auto',
      }}
    >
      <Row gutter={16}>
        <Col xs={24} sm={12}>
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
              mode="tags"
              allowClear
              showSearch
              loading={enteredLoading}
              optionFilterProp="label"
              placeholder="选择竞赛（可多选或直接输入 Slug 添加）"
              aria-label="出分监控竞赛"
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
        <Col xs={12} sm={6}>
          <Form.Item name="interval_minutes" label="刷新间隔" rules={[{ required: true }]}>
            <Select aria-label="出分监控刷新间隔" options={[
              { value: 1, label: '1 分钟' },
              { value: 2, label: '2 分钟' },
              { value: 5, label: '5 分钟' },
              { value: 10, label: '10 分钟' },
              { value: 15, label: '15 分钟' },
              { value: 30, label: '30 分钟' },
              { value: 60, label: '1 小时' },
            ]} />
          </Form.Item>
        </Col>
        <Col xs={12} sm={6}>
          <Form.Item
            name="page_size"
            label="每次拉取条数"
            tooltip="本人每日提交很少，默认 10 条足够覆盖近期待出分窗口"
            rules={[{ required: true }]}
          >
            <Select
              aria-label="提交列表页大小"
              options={[
                { value: 5, label: '5 条' },
                { value: 10, label: '10 条' },
                { value: 15, label: '15 条' },
                { value: 20, label: '20 条' },
                { value: 30, label: '30 条' },
                { value: 50, label: '50 条' },
              ]}
            />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item
            name="score_source"
            label="评分捕获策略"
            tooltip="迟提交或已完赛项目（如 Optiver）在 Kaggle 公开榜往往无分或为 0，选择智能自动会在完赛/零分时自动监听 Private 真实成绩"
          >
            <Select aria-label="评分策略" options={[
              { value: 'auto', label: '智能自动（完赛/迟提交优先 Private，常规优先 Public）' },
              { value: 'private', label: '优先 Private LB（迟提交 / 私有成绩模式）' },
              { value: 'public', label: '仅限 Public LB（常规公开榜单）' },
            ]} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item
            name="description_prefix"
            label="描述前缀过滤（可选）"
            extra="只监控 description 以该前缀开头的提交；留空表示全部"
          >
            <Input aria-label="提交描述前缀" placeholder="例如 dexp003 或 method-d" allowClear />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24}>
          <Form.Item name="enabled" valuePropName="checked" label="定时任务" style={{ marginBottom: 16 }}>
            <Switch checkedChildren="已启用" unCheckedChildren="已关闭" />
          </Form.Item>
        </Col>
      </Row>
    </Form>
  );
};

export default SubmissionConfigForm;
