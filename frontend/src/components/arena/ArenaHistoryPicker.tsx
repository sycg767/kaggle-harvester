import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Input, List, Pagination, Space, Tag } from 'antd';
import { History } from 'lucide-react';
import { api, type SimulationMonitorRunLog } from '../../api';

export default function ArenaHistoryPicker({ competition, selectedRun, onSelect }: {
  competition: string;
  selectedRun?: string;
  onSelect: (run?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState('');
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<SimulationMonitorRunLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || !competition) return;
    let active = true;
    setLoading(true); setError(''); setLogs([]); setTotal(0);
    void api.getSimulationHistory(competition, (page - 1) * 20, day).then(result => {
      if (!active) return;
      setLogs(result.logs); setTotal(result.total); setWarning(result.warning || '');
    }).catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [competition, open, day, page, retry]);

  return <>
    <Space wrap style={{ marginBottom: 12 }}>
      <Button icon={<History size={14} />} disabled={!competition} onClick={() => setOpen(true)}>历史快照</Button>
      {selectedRun && <Button onClick={() => onSelect()}>返回当前 / 最新快照</Button>}
    </Space>
    <Drawer title={`${competition} · 已保存快照`} open={open} onClose={() => setOpen(false)} width="min(560px, 100vw)">
      <p>按采集时间回看历史数据；仅列出成功保存的快照，不代表最终榜单。</p>
      <label>快照日期（UTC）<Input type="date" aria-label="快照日期（UTC）" value={day} onChange={event => { setDay(event.target.value); setPage(1); }} /></label>
      {error && <Alert type="error" message={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
      {warning && <Alert type="warning" message={warning} />}
      <List loading={loading} dataSource={logs} locale={{ emptyText: error ? '历史列表读取失败' : '此日期没有已保存快照' }} renderItem={log => (
        <List.Item actions={[<Button key="view" size="small" onClick={() => { onSelect(log.id); setOpen(false); }}>查看快照</Button>]}>
          <List.Item.Meta title={new Date(log.finished_at).toLocaleString('zh-CN')} description={<Space wrap><Tag>{log.outcome === 'success' ? '采集成功' : '部分数据'}</Tag><span>{log.agent_count} 个 Agent · {log.total_episodes_found} 场对局</span></Space>} />
        </List.Item>
      )} />
      <Pagination current={page} total={total} pageSize={20} showSizeChanger={false} onChange={setPage} size="small" showTotal={count => `共 ${count} 个快照`} />
    </Drawer>
  </>;
}
