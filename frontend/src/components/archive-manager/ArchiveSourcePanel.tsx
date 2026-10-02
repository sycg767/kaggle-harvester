import React, { useEffect, useState } from 'react';
import { Alert, Button, Select, Space, Spin, Tabs } from 'antd';
import type { ArchiveEntry } from '../../api';
import { archiveSourceApi, type SourcePreview, type SourceComparison } from '../../archiveSourceApi';
import { formatScore } from './archiveUtils';

interface Props { archive: ArchiveEntry; archives: ArchiveEntry[] }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试。';
const textStyle: React.CSSProperties = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 480, overflow: 'auto', padding: 16, background: 'var(--bg-tertiary, #f5f5f5)', fontSize: 12 };

export const ArchiveSourcePanel: React.FC<Props> = ({ archive, archives }) => {
  const [previewReload, setPreviewReload] = useState(0);
  const [compareReload, setCompareReload] = useState(0);
  const [tab, setTab] = useState('preview');
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [otherId, setOtherId] = useState<string>();
  const [comparison, setComparison] = useState<SourceComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState('');
  const versions = archives.filter(item => item.ref === archive.ref && item.version_number !== archive.version_number && item.id !== archive.id);
  const other = versions.find(item => item.id === otherId);

  useEffect(() => {
    if (tab !== 'preview') return;
    let active = true;
    setPreview(null); setPreviewError('');
    archiveSourceApi.preview(archive.id).then(value => { if (active) setPreview(value); })
      .catch(err => { if (active) setPreviewError(errorMessage(err)); });
    return () => { active = false; };
  }, [archive.id, tab, previewReload]);

  useEffect(() => {
    setComparison(null); setCompareError('');
    if (!otherId) return;
    let active = true;
    setComparing(true);
    archiveSourceApi.compare(archive.id, otherId).then(value => { if (active) setComparison(value); })
      .catch(err => { if (active) setCompareError(errorMessage(err)); })
      .finally(() => { if (active) setComparing(false); });
    return () => { active = false; };
  }, [archive.id, otherId, compareReload]);

  return <section className="detail-section">
    <Alert type="info" showIcon message="此版本保存在应用服务器" description="源码归档与环境元数据不代表完整运行环境已封存，也不代表平台验证过复现。" />
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'preview', label: '源码预览', children: previewError ? <Alert type="error" message={previewError} action={<Button onClick={() => setPreviewReload(value => value + 1)}>重试</Button>} /> : !preview ? <Spin /> : <>
        <p>{preview.filename} · 纯文本预览，不执行代码或 HTML</p>
        {preview.truncated && <Alert type="warning" message="预览已截断，可下载源文件查看完整内容。" />}
        <pre style={textStyle}>{preview.content || '源文件没有文本内容。'}</pre>
      </> },
      { key: 'compare', label: '版本比较', children: <Space direction="vertical" style={{ width: '100%' }}>
        <p>当前：v{archive.version_number} · 公开分数 {formatScore(archive.public_score)}</p>
        <Select aria-label="选择比较版本" style={{ width: '100%' }} placeholder={versions.length ? '选择同一 Notebook 的其他归档版本' : '暂无其他归档版本'} value={otherId} disabled={!versions.length} onChange={setOtherId} options={versions.map(item => ({ value: item.id, label: `v${item.version_number} · ${formatScore(item.public_score)} · ${item.archived_at}` }))} />
        {other && <p>比较：v{other.version_number} · 公开分数 {formatScore(other.public_score)}。分数来自归档记录；高低不自动代表更优。</p>}
        {comparing && <Spin />}
        {compareError && <Alert type="error" message={compareError} action={<Button onClick={() => setCompareReload(value => value + 1)}>重试</Button>} />}
        {comparison && <>{comparison.truncated && <Alert type="warning" message="差异已截断，请下载完整版本进一步比较。" />}<pre style={textStyle}>{comparison.diff || (comparison.truncated ? '已展示范围内没有源码差异，完整版本仍需下载比较。' : '这两个版本的源码文本相同。')}</pre></>}
      </Space> },
    ]} />
  </section>;
};
