import React, { useMemo } from 'react';
import { Button, Card, Space, Table, Tag, Tooltip, Typography, type TableColumnsType } from 'antd';
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import { Flame, Zap } from 'lucide-react';
import type { AvailableSubmissionItem } from './SettingsDrawer';
import { formatDate } from './utils';

const { Text } = Typography;

interface CandidateSubmissionsViewProps {
  targetCompTitle: string;
  targetCompetition: string;
  isMonitoringActive: boolean;
  activeMonitoredCompetition?: string;
  availableSubmissions: AvailableSubmissionItem[];
  loadingSubmissions: boolean;
  onQuickEnable: () => void;
  onRefreshSubmissions: () => void;
  onSelectSubmissionAsTarget: (subId: number) => void;
  onCopyId: (id: number) => void;
}

export const CandidateSubmissionsView: React.FC<CandidateSubmissionsViewProps> = ({
  targetCompTitle,
  targetCompetition,
  isMonitoringActive,
  activeMonitoredCompetition,
  availableSubmissions,
  loadingSubmissions,
  onQuickEnable,
  onRefreshSubmissions,
  onSelectSubmissionAsTarget,
  onCopyId,
}) => {
  const candidateSubColumns: TableColumnsType<AvailableSubmissionItem> = useMemo(() => [
    {
      title: '提交 ID',
      dataIndex: 'submission_id',
      key: 'submission_id',
      width: 140,
      render: (id: number) => (
        <Space size={4}>
          <Text code style={{ fontSize: 13, fontWeight: 700 }}>#{id}</Text>
          <Tooltip title="复制提交 ID">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined style={{ fontSize: 12, color: '#64748b' }} />}
              onClick={() => onCopyId(id)}
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '描述 / 模型文件名',
      key: 'desc',
      ellipsis: true,
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
            {r.description || r.file_name || '未命名提交'}
          </div>
          {r.description && r.file_name && r.description !== r.file_name && (
            <div style={{ fontSize: 11, color: '#64748b' }}>{r.file_name}</div>
          )}
        </div>
      ),
    },
    {
      title: '队伍 / 提交者',
      dataIndex: 'team_name',
      key: 'team_name',
      width: 160,
      render: (t: string) => <Text style={{ fontSize: 12 }}>{t || '我方团队'}</Text>,
    },
    {
      title: '提交时间',
      dataIndex: 'date',
      key: 'date',
      width: 150,
      render: (d: string) => <Text type="secondary" style={{ fontSize: 12 }}>{formatDate(d)}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: string) => {
        const isOk = s?.toLowerCase().includes('complete') || s?.toLowerCase().includes('success');
        const isPending = s?.toLowerCase().includes('pending') || s?.toLowerCase().includes('running');
        return (
          <Tag color={isOk ? 'success' : isPending ? 'processing' : 'default'} style={{ margin: 0, fontWeight: 600 }}>
            {s || '—'}
          </Tag>
        );
      },
    },
    {
      title: 'Kaggle 得分',
      dataIndex: 'public_score',
      key: 'public_score',
      width: 110,
      align: 'right',
      render: (sc?: number | null) => (
        <span style={{ fontWeight: 800, fontSize: 13, color: sc !== undefined && sc !== null ? '#0f172a' : '#94a3b8' }}>
          {sc !== undefined && sc !== null ? Number(sc).toFixed(1) : '—'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      align: 'center',
      render: (_, r) => (
        <Button
          size="small"
          type="primary"
          ghost
          onClick={() => onSelectSubmissionAsTarget(r.submission_id)}
        >
          设为监控目标
        </Button>
      ),
    },
  ], [onCopyId, onSelectSubmissionAsTarget]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card
        size="small"
        className="sim-banner-card"
        styles={{ body: { padding: '16px 20px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Tag color="blue" style={{ margin: 0, fontWeight: 700 }}>待命就绪</Tag>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                【{targetCompTitle}】已识别为模拟/智能体对抗竞赛
              </span>
            </div>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {isMonitoringActive ? (
                <>
                  后台定时巡检当前正在监控其他赛事（<code>{activeMonitoredCompetition}</code>）。已为您拉取到当前赛事的 <strong>{availableSubmissions.length}</strong> 个历史提交记录。您可以随时配置并切换为此赛事的自动化巡检。
                </>
              ) : (
                <>
                  当前后台未开启任何赛事的定时巡检（处于待命状态）。已为您拉取到该赛事的 <strong>{availableSubmissions.length}</strong> 个历史提交记录，您可以随时勾选智能体并开启自动化巡检。
                </>
              )}
            </Text>
          </div>

          <Space size={8}>
            <Button
              type="primary"
              icon={<Zap size={14} style={{ marginRight: 4 }} />}
              onClick={onQuickEnable}
            >
              快捷选定有效提交开启
            </Button>
            <Button
              icon={<ReloadOutlined spin={loadingSubmissions} />}
              loading={loadingSubmissions}
              onClick={onRefreshSubmissions}
            >
              重新拉取提交
            </Button>
          </Space>
        </div>
      </Card>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Flame size={16} color="#f97316" />
            <Text strong style={{ fontSize: 14 }}>我方候选智能体提交列表 ({availableSubmissions.length})</Text>
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            点击「设为监控目标」即可快速填入监控目标并准备启动
          </Text>
        </div>

        <Table
          columns={candidateSubColumns}
          dataSource={availableSubmissions}
          rowKey="submission_id"
          size="small"
          loading={loadingSubmissions}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          bordered
        />
      </div>
    </div>
  );
};

export default CandidateSubmissionsView;
