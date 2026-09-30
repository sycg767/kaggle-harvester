import React, { useEffect, useState } from 'react';
import { Alert, App, Button, Input, Select, Space, Spin, Tabs } from 'antd';
import type { ArchiveEntry } from '../../api';
import { archiveStudyApi, studyOptions, type ArchiveStudy, type SourcePreview, type SourceComparison } from '../../archiveStudyApi';
import { formatScore } from './archiveUtils';

interface Props { archive: ArchiveEntry; archives: ArchiveEntry[]; onSaved: (id: string, study: ArchiveStudy) => void; onDirtyChange: (dirty: boolean) => void }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试。';
const textStyle: React.CSSProperties = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 480, overflow: 'auto', padding: 16, background: 'var(--bg-tertiary, #f5f5f5)', fontSize: 12 };

export const ArchiveStudyPanel: React.FC<Props> = ({ archive, archives, onSaved, onDirtyChange }) => {
  const { message } = App.useApp();
  const [study, setStudy] = useState<ArchiveStudy>({ status: 'unread', notes: '', tags: [] });
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [saveError, setSaveError] = useState('');
  const [previewReload, setPreviewReload] = useState(0);
  const [compareReload, setCompareReload] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState('study');
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [otherId, setOtherId] = useState<string>();
  const [comparison, setComparison] = useState<SourceComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState('');
  const snapshot = JSON.stringify({ status: study.status, notes: study.notes, tags: study.tags });
  const dirty = loaded && savedSnapshot !== snapshot;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const versions = archives.filter(item => item.ref === archive.ref && item.version_number !== archive.version_number && item.id !== archive.id);
  const other = versions.find(item => item.id === otherId);

  useEffect(() => {
    let active = true;
    setLoaded(false); setError('');
    archiveStudyApi.get(archive.id).then(value => { if (active) { setStudy(value); setSavedSnapshot(JSON.stringify({ status: value.status, notes: value.notes, tags: value.tags })); setLoaded(true); } })
      .catch(err => { if (active) setError(errorMessage(err)); });
    return () => { active = false; };
  }, [archive.id, reload]);

  useEffect(() => {
    if (tab !== 'preview') return;
    let active = true;
    setPreview(null); setPreviewError('');
    archiveStudyApi.preview(archive.id).then(value => { if (active) setPreview(value); })
      .catch(err => { if (active) setPreviewError(errorMessage(err)); });
    return () => { active = false; };
  }, [archive.id, tab, previewReload]);

  useEffect(() => {
    setComparison(null); setCompareError('');
    if (!otherId) return;
    let active = true;
    setComparing(true);
    archiveStudyApi.compare(archive.id, otherId).then(value => { if (active) setComparison(value); })
      .catch(err => { if (active) setCompareError(errorMessage(err)); })
      .finally(() => { if (active) setComparing(false); });
    return () => { active = false; };
  }, [archive.id, otherId, compareReload]);

  const save = async () => {
    setSaving(true); setSaveError('');
    try { const saved = await archiveStudyApi.save(archive.id, study); setStudy(saved); setSavedSnapshot(JSON.stringify({ status: saved.status, notes: saved.notes, tags: saved.tags })); onSaved(archive.id, saved); message.success('研究记录已保存到服务器'); }
    catch (err) { setSaveError(errorMessage(err)); }
    finally { setSaving(false); }
  };

  return <section className="detail-section">
    <Alert type="info" showIcon message="此版本保存在应用服务器" description="源码归档与环境元数据不代表完整运行环境已封存，也不代表平台验证过复现。研究状态由使用者记录。" />
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'study', label: '研究记录', children: error ? <Alert type="error" message={error} action={<Button onClick={() => setReload(value => value + 1)}>重试</Button>} /> : !loaded ? <Spin /> : <Space direction="vertical" style={{ width: '100%' }}>
        <label htmlFor="archive-study-status">阅读与复现状态</label>
        <Select disabled={saving} id="archive-study-status" style={{ width: '100%' }} value={study.status} options={studyOptions} onChange={status => setStudy(value => ({ ...value, status }))} />
        <label htmlFor="archive-study-tags">标签</label>
        <Select disabled={saving} id="archive-study-tags" mode="tags" maxCount={20} style={{ width: '100%' }} value={study.tags} placeholder="例如：基线、特征工程、待消融" onChange={tags => setStudy(value => ({ ...value, tags: tags.map(tag => tag.slice(0, 100)) }))} />
        <label htmlFor="archive-study-notes">研究笔记</label>
        <Input.TextArea disabled={saving} id="archive-study-notes" rows={5} maxLength={10000} showCount value={study.notes} placeholder="为什么收藏？关键方法是什么？复现条件与结果有哪些？" onChange={event => setStudy(value => ({ ...value, notes: event.target.value }))} />
        {dirty && <Alert type="warning" message="研究记录尚未保存" />}
        {saveError && <Alert type="error" message={saveError} />}
        <Button type="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>保存研究记录</Button>
        {study.updated_at && <small>最近保存：{new Date(study.updated_at).toLocaleString()}</small>}
      </Space> },
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
