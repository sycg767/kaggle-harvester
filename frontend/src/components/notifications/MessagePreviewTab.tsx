import React, { useState } from 'react';
import { Divider, Segmented, Space, Typography } from 'antd';
import { Archive, Swords, TrendingUp } from 'lucide-react';

const { Text } = Typography;

export const MessagePreviewTab: React.FC = () => {
  const [previewType, setPreviewType] = useState<'sim' | 'score' | 'archive'>('sim');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          示例预览：以下赛事、积分和数量均为演示数据，实际通知内容与样式以投递结果为准。
        </Text>
        <Segmented
          value={previewType}
          onChange={(val) => setPreviewType(val as 'sim' | 'score' | 'archive')}
          options={[
            {
              label: (
                <Space size={5}>
                  <Swords size={13} color="#d97706" />
                  <span>宝可梦对战战报</span>
                </Space>
              ),
              value: 'sim',
            },
            {
              label: (
                <Space size={5}>
                  <TrendingUp size={13} color="#2563eb" />
                  <span>提交出分提醒</span>
                </Space>
              ),
              value: 'score',
            },
            {
              label: (
                <Space size={5}>
                  <Archive size={13} color="#7c3aed" />
                  <span>自动归档通知</span>
                </Space>
              ),
              value: 'archive',
            },
          ]}
        />
      </div>

      {/* Mock Message Container */}
      <div
        style={{
          background: '#0f172a',
          borderRadius: 12,
          padding: '20px 24px',
          color: '#f8fafc',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 13,
          lineHeight: 1.6,
          border: '1px solid #1e293b',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        }}
      >
        {previewType === 'sim' && (
          <div>
            <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: 15, marginBottom: 8 }}>
              【Pokemon TCG AI 对战实时战报】
            </div>
            <div style={{ color: '#4ade80', fontWeight: 700, marginBottom: 4 }}>
              Agent p46 (Sub #55565346)
            </div>
            <div style={{ paddingLeft: 12, color: '#e2e8f0' }}>
              • 天梯积分: <span style={{ color: '#facc15', fontWeight: 800 }}>858.1</span> 分 (第 580 名 | <span style={{ color: '#fb923c' }}>铜牌线内</span>)<br />
              • 铜牌安全垫: <span style={{ color: '#4ade80', fontWeight: 700 }}>高于铜牌线 +19.0分</span><br />
              • 战绩胜率: 52.9% (37胜 / 33负)<br />
              • 最新战况: <span style={{ color: '#38bdf8' }}>vs AlphaPoke (845分) 胜利 +3.9分</span>
            </div>
            <Divider style={{ borderColor: '#334155', margin: '10px 0' }} />
            <div style={{ color: '#94a3b8', fontSize: 12 }}>
              奖牌线切分（总参赛队伍: 6,807 队）<br />
              • 金牌线: 1131.9 分 (Top 23)<br />
              • 银牌线: 917.4 分 (Top 340)<br />
              • 铜牌线: 839.1 分 (Top 680)
            </div>
          </div>
        )}

        {previewType === 'score' && (
          <div>
            <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: 15, marginBottom: 8 }}>
              [出分提醒] Kaggle Harvester：提交已出分 (新纪录！)
            </div>
            <div style={{ color: '#e2e8f0', marginBottom: 4 }}>
              • 竞赛项目: <span style={{ color: '#facc15' }}>biohub-cell-tracking-during-development</span><br />
              • 提交说明: <span style={{ color: '#38bdf8' }}>exp-04-unet-transformer-ensemble</span><br />
              • 最新得分: <span style={{ color: '#4ade80', fontWeight: 800, fontSize: 16 }}>0.8924</span> (历史最佳突破！)<br />
              • 提交时间: 2026-08-18 16:40:27（北京时间）
            </div>
          </div>
        )}

        {previewType === 'archive' && (
          <div>
            <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: 15, marginBottom: 8 }}>
              [自动归档] Kaggle Harvester：发现并归档新高分 Kernel
            </div>
            <div style={{ color: '#e2e8f0' }}>
              • 竞赛项目: biohub-cell-tracking-during-development<br />
              • 归档明细:<br />
              &nbsp;&nbsp;✔ <span style={{ color: '#facc15' }}>dr-kaggle/cell-seg-baseline</span> · 得分: 0.8841 · 版本: v3<br />
              &nbsp;&nbsp;✔ <span style={{ color: '#facc15' }}>grandmaster/fast-inference-fp16</span> · 得分: 0.8812 · 版本: v7<br />
              • 本地存储: data/archives/... 已就绪（包含源码与依赖）
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessagePreviewTab;
