export const formatBytes = (value = 0) => {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
};

export const formatRelativeTime = (timeStr?: string | null) => {
  if (!timeStr) return '';
  try {
    const target = new Date(timeStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - target.getTime()) / 1000);
    if (diffSec < 0) {
      const futureSec = Math.abs(diffSec);
      if (futureSec < 60) return `${futureSec} 秒后`;
      if (futureSec < 3600) return `${Math.floor(futureSec / 60)} 分钟后`;
      return `${Math.floor(futureSec / 3600)} 小时后`;
    }
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
    return `${Math.floor(diffSec / 86400)} 天前`;
  } catch {
    return timeStr;
  }
};
