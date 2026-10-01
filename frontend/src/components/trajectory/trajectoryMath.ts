import type { SimulationAgentStats, SimulationRatingPoint } from '../../api';

export interface ChartPoint {
  x: number;
  y: number;
  timestamp?: string;
  episodeId: number;
  scoreDelta?: number;
  result: SimulationRatingPoint['result'];
}

export interface ChartSeries {
  id: number;
  label: string;
  color: string;
  points: ChartPoint[];
  latest?: ChartPoint;
  games: number;
}

export const COLORS = ['#d14343', '#3478c5', '#8b5cf6', '#0f9d75', '#d97706'];
export const VIEWBOX_WIDTH = 920;
export const VIEWBOX_HEIGHT = 400;
export const PLOT = { left: 68, right: 36, top: 48, bottom: 50 };

export const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

export const formatTime = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const labelForAgent = (agent: SimulationAgentStats, index: number): string => {
  if (agent.alias && agent.alias.trim()) return agent.alias.trim();
  if (agent.submission_id === 55565346) return 'p46';
  if (agent.submission_id === 55555162) return 'p31';
  const raw = (agent.description || agent.file_name || '').trim();
  const match = raw.match(/^(p\d+(?:plus\d+)?|p\d+|agent[\s\-_]?\w+)/i);
  if (match) return match[1].replace(/[:_\-—]+$/, '');
  if (raw && !raw.toLowerCase().startsWith('agent') && raw.length <= 15) {
    return raw.replace(/[:_\-—]+$/, '');
  }
  return `Agent #${index + 1}`;
};

export const buildLegacyTrajectory = (agent: SimulationAgentStats): SimulationRatingPoint[] => {
  const episodes = (agent.recent_episodes || [])
    .filter((episode) => !episode.is_system_check)
    .slice()
    .sort((a, b) => {
      const aTime = a.end_time || a.create_time || '';
      const bTime = b.end_time || b.create_time || '';
      return aTime.localeCompare(bTime) || a.id - b.id;
    });
  const finalScore = agent.score ?? agent.public_score;
  if (finalScore === undefined || finalScore === null || episodes.length === 0) return [];

  let scoreAfter = finalScore;
  const reversed: SimulationRatingPoint[] = [];
  for (const [index, episode] of episodes.map((item, itemIndex) => [itemIndex + 1, item] as const).reverse()) {
    reversed.push({
      episode_id: episode.id,
      game_number: index,
      timestamp: episode.end_time || episode.create_time,
      score: Number(scoreAfter.toFixed(1)),
      score_delta: episode.score_delta,
      result: episode.result,
    });
    scoreAfter = Number((scoreAfter - (episode.score_delta || 0)).toFixed(1));
  }
  return reversed.reverse();
};

export const buildPath = (points: ChartPoint[]): string =>
  points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

export const calculateYAxisTicks = (min: number, max: number, targetCount: number = 6): { yMin: number; yMax: number; ticks: number[] } => {
  if (max <= min) {
    const rounded = Math.round(min);
    return { yMin: rounded - 50, yMax: rounded + 50, ticks: [rounded - 50, rounded, rounded + 50] };
  }
  const rawStep = (max - min) / Math.max(1, targetCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;

  let stepMultiplier = 10;
  if (normalized <= 1.25) stepMultiplier = 1;
  else if (normalized <= 2.2) stepMultiplier = 2;
  else if (normalized <= 3.8) stepMultiplier = 2.5;
  else if (normalized <= 7.0) stepMultiplier = 5;

  const step = Math.max(1, Math.round(stepMultiplier * magnitude));
  const yMin = Math.floor(min / step) * step;
  const yMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let val = yMin; val <= yMax + 1e-5; val += step) {
    ticks.push(Math.round(val * 1e6) / 1e6);
  }
  return { yMin, yMax, ticks };
};

export const integerTicks = (min: number, max: number, count: number): number[] => {
  if (max <= min) return [Math.round(min)];
  const rawStep = (max - min) / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = Math.max(1, (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude);
  const first = Math.ceil(min / step) * step;
  const last = Math.ceil(max / step) * step;
  return Array.from(
    { length: Math.max(1, Math.floor((last - first) / step) + 1) },
    (_, index) => Math.round((first + index * step) * 1e6) / 1e6,
  );
};
