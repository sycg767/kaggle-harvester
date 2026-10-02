// An HTTP response confirms completion of the request, not success of the collection.
export function monitorResult(snapshot: {
  status: { last_error?: string | null };
  logs?: Array<{ outcome?: string; error?: string | null }>;
}, successText: string): { type: 'success' | 'warning' | 'error'; content: string } {
  const log = snapshot.logs?.[0];
  const error = snapshot.status.last_error || log?.error;
  if (log?.outcome === 'failed') return { type: 'error', content: `检查失败：${error || '未取得新数据'}` };
  if (log?.outcome === 'partial' || error) return { type: 'warning', content: `检查未全部完成：${error || '部分数据未更新'}` };
  return { type: 'success', content: successText };
}
