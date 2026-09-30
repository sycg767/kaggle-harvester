import React, { useState } from 'react';
import { Alert, Button, Space, Typography, type FormInstance } from 'antd';
import { api, type AutoArchiveConfig } from '../../api';

export default function ArchiveRulePreview({ form }: { form: FormInstance<AutoArchiveConfig> }) {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState('');
  const preview = async () => {
    setBusy(true); setError(''); setLines([]);
    try {
      const config = await form.validateFields();
      const results: string[] = [];
      for (const competition of config.competitions || []) {
        const threshold = config.score_thresholds[competition];
        if (!Number.isFinite(threshold)) throw new Error(`请先设置 ${competition} 的分数阈值`);
        let lower = config.score_direction === 'minimize';
        if (config.score_direction === 'auto') {
          const info = await api.getCompetition(competition);
          if (info.score_direction_source === 'fallback') throw new Error(`${competition} 分数方向未知，无法安全预览`);
          lower = info.is_lower_better;
        }
        const list = await api.listKernels({ competition, sort_by: lower ? 'scoreAscending' : 'scoreDescending',
          page_size: 50, max_pages: 1, include_scores: true, score_limit: 50 });
        const scored = list.items.filter(item => item.public_score != null);
        const matches = scored.filter(item => lower ? item.public_score! < threshold : item.public_score! > threshold);
        results.push(`${competition}：公开分 ${lower ? '<' : '>'} ${threshold}；已获取 ${list.items.length} 条，其中 ${scored.length} 条有分数，${matches.length} 条符合。${list.cache.state === 'STALE' ? '当前使用旧缓存。' : ''}`);
      }
      setLines(results.length ? results : ['请先选择要预览的赛事。']);
    } catch (e) { setError(e instanceof Error ? e.message : '请检查配置后重试'); }
    finally { setBusy(false); }
  };
  return <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
    <Button loading={busy} onClick={() => void preview()}>预览当前条件，不保存或下载</Button>
    <Typography.Text type="secondary">预览仅统计获取到的榜单候选，不扫描历史版本，不等于最终新增归档数。修改配置后请重新预览。</Typography.Text>
    {lines.map(line => <Alert key={line} message={line} type="info" />)}
    {error && <Alert type="warning" message={error} />}
  </Space>;
}
