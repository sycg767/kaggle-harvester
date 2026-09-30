import React, { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Collapse, Progress, Space, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { archiveJobs, summarizeArchiveJob, type ArchiveJob } from '../archiveJobs';
import { dispatchArchivesChanged } from '../events';

export default function ArchiveJobsPanel({ competition }: { competition?: string }) {
  const { message } = App.useApp();
  const [jobs, setJobs] = useState<ArchiveJob[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let stopped = false;
    setJobs([]);
    setError('');
    let timer: ReturnType<typeof setTimeout>;
    let previous = '';
    const poll = async () => {
      let active = false;
      try {
        const data = await archiveJobs.list(competition);
        if (stopped) return;
        if (!Array.isArray(data)) throw new Error('Invalid task response');
        setJobs(data); setError('');
        active = data.some(job => ['pending', 'running'].includes(job.status));
        const progress = JSON.stringify(data.map(job => [job.id, job.updated_at]));
        if (previous !== progress && data.some(job => job.items.some(item => ['succeeded', 'existing'].includes(item.status)))) dispatchArchivesChanged();
        previous = progress;
      } catch {
        if (!stopped) setError('任务状态暂未同步，服务器上的任务可能仍在执行。请勿重复提交。');
      }
      if (!stopped) timer = setTimeout(() => void poll(), active ? 5000 : 30000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [competition, revision]);
  useEffect(() => {
    window.addEventListener('harvester:archive-jobs-changed', refresh);
    return () => window.removeEventListener('harvester:archive-jobs-changed', refresh);
  }, [refresh]);
  const action = async (id: string, retry: boolean) => {
    if (busy) return;
    setBusy(id);
    try { await (retry ? archiveJobs.retry(id) : archiveJobs.cancel(id)); refresh(); }
    catch (e) { message.error(e instanceof Error ? e.message : '操作未完成'); }
    finally { setBusy(''); }
  };
  if (!jobs.length && !error) return null;
  return <section style={{ marginBottom: 20 }} aria-label="后台归档任务">
    {error && <Alert type="warning" showIcon message={error} action={<Button onClick={refresh}>刷新</Button>} />}
    <Collapse items={[{
      key: 'jobs', label: `后台归档任务 · 最近 ${jobs.length} 次（离开页面后继续执行）`,
      children: <Space direction="vertical" size={18} style={{ width: '100%' }}>
        {jobs.map(job => {
          const s = summarizeArchiveJob(job);
          return <div key={job.id}>
            {job.persistence_error && <Alert type="error" showIcon message="任务状态保存失败，队列已暂停重试" description={job.persistence_error} />}
            <Space wrap>
              <Typography.Text strong>{new Date(job.created_at).toLocaleString()} · {job.items.length} 项</Typography.Text>
              <Typography.Text>新增 {s.added} / 已存在 {s.existing} / 失败 {s.failed} / 已取消 {s.cancelled}</Typography.Text>
              {!!s.failed && <Button size="small" loading={busy === job.id} onClick={() => void action(job.id, true)}>仅重试失败项</Button>}
              {!!s.pending && <Button size="small" loading={busy === job.id} onClick={() => void action(job.id, false)}>取消未开始项</Button>}
            </Space>
            <Progress percent={s.percent} status={s.running || s.pending ? 'active' : s.failed ? 'exception' : 'normal'} />
            <details><summary>查看每项结果{(s.running || s.pending) ? ` · 执行中 ${s.running}，等待 ${s.pending}` : ''}</summary>
              {job.items.map(item => {
                const result = item.result;
                const id = result ? `${result.owner_slug}__${result.kernel_slug}__v${result.selected_version}` : '';
                const label: Record<string, string> = { pending: '等待执行', running: '执行中', succeeded: '新增归档', existing: '版本已存在', failed: '失败', cancelled: '已取消' };
                return <div key={item.id} style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
                  {item.request.kernel_ref} · {label[item.status] || item.status}
                  {item.error && <Typography.Text type="danger"> · {item.error}</Typography.Text>}
                  {id && <Link style={{ marginLeft: 12 }} to={`/archives?archive=${encodeURIComponent(id)}`}>阅读归档 v{result?.selected_version}</Link>}
                </div>;
              })}
            </details>
          </div>;
        })}
      </Space>,
    }]} />
  </section>;
}
