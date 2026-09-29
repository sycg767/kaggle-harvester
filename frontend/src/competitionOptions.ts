import type { EnteredCompetition } from './api';

/** 展示名：有独立 title 时优先；title 与 slug 相同时只显示 slug。 */
export function competitionDisplayName(item: Pick<EnteredCompetition, 'id' | 'title'> | string): string {
  if (typeof item === 'string') {
    return item;
  }
  const title = (item.title || '').trim();
  if (title && title.toLowerCase() !== item.id.toLowerCase()) {
    return title;
  }
  return item.id;
}

/** 判断比赛是否已经截止完赛 */
export function isCompetitionEnded(deadline?: string | null): boolean {
  if (!deadline) return false;
  try {
    const end = new Date(deadline).getTime();
    return !Number.isNaN(end) && end < Date.now();
  } catch {
    return false;
  }
}

export function competitionOptionLabel(
  item: Pick<EnteredCompetition, 'id' | 'title'> | string,
  extraHint?: string,
): string {
  const slug = typeof item === 'string' ? item : item.id;
  const name = competitionDisplayName(item);
  if (name !== slug) {
    return extraHint ? `${name} · ${extraHint}` : name;
  }
  return extraHint ? `${slug} · ${extraHint}` : slug;
}

export interface BuildCompetitionOptionsConfig {
  activeSlug?: string | null;
  excludeEnded?: boolean;
  currentSlug?: string | null;
}

export function buildEnteredCompetitionOptions(
  entered: EnteredCompetition[],
  extras: Array<string | undefined | null> = [],
  activeSlugOrConfig?: string | null | BuildCompetitionOptionsConfig,
  excludeEndedParam = true,
): Array<{ value: string; label: string }> {
  let activeSlug: string | null | undefined;
  let excludeEnded = true;
  let currentSlug: string | null | undefined;

  if (activeSlugOrConfig && typeof activeSlugOrConfig === 'object') {
    activeSlug = activeSlugOrConfig.activeSlug;
    excludeEnded = activeSlugOrConfig.excludeEnded !== false;
    currentSlug = activeSlugOrConfig.currentSlug;
  } else {
    activeSlug = activeSlugOrConfig;
    excludeEnded = excludeEndedParam !== false;
  }

  const enteredDeadlines = new Map(
    entered.map((item) => [item.id.toLowerCase(), item.deadline])
  );

  const filteredEntered = excludeEnded
    ? entered.filter((item) => {
        if (!isCompetitionEnded(item.deadline)) return true;
        // 如果当前选中的正是该比赛，保留以确保下拉框正常展示当前项
        if (currentSlug && item.id.toLowerCase() === currentSlug.toLowerCase()) return true;
        return false;
      })
    : entered;

  const fromEntered = filteredEntered.map((item) => {
    const isDefault = activeSlug && item.id.toLowerCase() === activeSlug.toLowerCase();
    const isEnded = isCompetitionEnded(item.deadline);
    const hint = isDefault
      ? (isEnded ? '⭐ 全站主攻 · 已结束' : '⭐ 全站主攻')
      : (isEnded ? '已结束' : undefined);
    return {
      value: item.id,
      label: competitionOptionLabel(item, hint),
    };
  });

  const known = new Set(fromEntered.map((item) => item.value));
  const extraOptions = extras
    .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
    .filter((slug) => !known.has(slug))
    .filter((slug) => {
      if (!excludeEnded) return true;
      if (currentSlug && slug.toLowerCase() === currentSlug.toLowerCase()) return true;
      const deadline = enteredDeadlines.get(slug.toLowerCase());
      if (deadline && isCompetitionEnded(deadline)) return false;
      return true;
    })
    .map((slug) => {
      known.add(slug);
      const isDefault = activeSlug && slug.toLowerCase() === activeSlug.toLowerCase();
      const deadline = enteredDeadlines.get(slug.toLowerCase());
      const isEnded = deadline ? isCompetitionEnded(deadline) : false;
      const hint = isDefault
        ? (isEnded ? '⭐ 全站主攻 · 已结束' : '⭐ 全站主攻')
        : (isEnded ? '已结束' : '已保存');
      return {
        value: slug,
        label: competitionOptionLabel(slug, hint),
      };
    });

  return [...fromEntered, ...extraOptions];
}
