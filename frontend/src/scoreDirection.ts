import type { CompetitionInfo } from './api';

export type ScoreDirection = 'minimize' | 'maximize';

const STORAGE_KEY = 'harvester.scoreDirections';

export function readScoreDirections(): Record<string, ScoreDirection> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, ScoreDirection] => (
        entry[1] === 'minimize' || entry[1] === 'maximize'
      )),
    );
  } catch {
    return {};
  }
}

export function saveScoreDirection(competition: string, direction: ScoreDirection): void {
  const values = readScoreDirections();
  values[competition] = direction;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
}

export function resolveScoreDirection(
  competition: string,
  info: CompetitionInfo | null,
): { direction: ScoreDirection | null; source: CompetitionInfo['score_direction_source'] | 'user' | 'unknown' } {
  if (info && info.score_direction_source !== 'fallback') {
    return { direction: info.is_lower_better ? 'minimize' : 'maximize', source: info.score_direction_source };
  }
  const saved = readScoreDirections()[competition];
  return saved ? { direction: saved, source: 'user' } : { direction: null, source: 'unknown' };
}
