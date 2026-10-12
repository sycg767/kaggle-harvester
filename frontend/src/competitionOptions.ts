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

/**
 * Kaggle 官方 API 返回的 deadline 通常为 UTC 时间（如 2026-09-30T23:59:00），
 * 若缺少时区指示符，按 UTC 解析，避免浏览器本地时区解析偏差导致提前 8 小时误判为已结束。
 */
export function parseKaggleDeadline(deadline?: string | null): Date | null {
  if (!deadline) return null;
  const trimmed = deadline.trim();
  if (!trimmed) return null;
  const hasTz = /([Zz]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const normalized = hasTz ? trimmed : `${trimmed}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 判断比赛是否已经截止完赛 */
export function isCompetitionEnded(deadline?: string | null): boolean {
  const d = parseKaggleDeadline(deadline);
  if (!d) return false;
  return d.getTime() < Date.now();
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

export const ALLOWED_LATE_SUBMISSION_COMPETITIONS = new Set<string>([
  'optiver-trading-at-the-close',
]);

export interface BuildCompetitionOptionsConfig {
  activeSlug?: string | null;
  excludeEnded?: boolean;
  currentSlug?: string | null;
  allowedEndedSlugs?: Iterable<string>;
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
  let allowedEndedSlugs: Iterable<string> | undefined;

  if (activeSlugOrConfig && typeof activeSlugOrConfig === 'object') {
    activeSlug = activeSlugOrConfig.activeSlug;
    excludeEnded = activeSlugOrConfig.excludeEnded !== false;
    currentSlug = activeSlugOrConfig.currentSlug;
    allowedEndedSlugs = activeSlugOrConfig.allowedEndedSlugs;
  } else {
    activeSlug = activeSlugOrConfig;
    excludeEnded = excludeEndedParam !== false;
  }

  const allowedEnded = new Set<string>(
    allowedEndedSlugs
      ? Array.from(allowedEndedSlugs).map((s) => s.toLowerCase())
      : []
  );

  const extraSlugsLower = new Set(
    extras
      .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
      .map((slug) => slug.toLowerCase())
  );

  const enteredDeadlines = new Map(
    entered.map((item) => [item.id.toLowerCase(), item.deadline])
  );

  const filteredEntered = excludeEnded
    ? entered.filter((item) => {
        const idLower = item.id.toLowerCase();
        // 1. 进行中的竞赛正常保留
        if (!isCompetitionEnded(item.deadline)) return true;
        // 2. 当前选中或当前页面的竞赛保留
        if (currentSlug && idLower === currentSlug.toLowerCase()) return true;
        // 3. 用户已经在配置 extras 中选定保存的竞赛始终保留，不因完赛被隐藏
        if (extraSlugsLower.has(idLower)) return true;
        // 4. 用户指定需要的特定迟提交/完赛赛事（如 optiver-trading-at-the-close）单独保留
        if (allowedEnded.has(idLower)) return true;
        // 其余未特别需要的历史已完赛赛事一律过滤，避免选项过度冗余
        return false;
      })
    : entered;

  const fromEntered = filteredEntered.map((item) => {
    const isDefault = activeSlug && item.id.toLowerCase() === activeSlug.toLowerCase();
    const isEnded = isCompetitionEnded(item.deadline);
    const hint = isDefault
      ? (isEnded ? '全站主攻 · 迟提交 / 已完赛' : '全站主攻')
      : (isEnded ? '迟提交 / 已完赛' : undefined);
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
      const slugLower = slug.toLowerCase();
      if (!excludeEnded) return true;
      // 显式传入 extras 的配置项始终保留
      if (extraSlugsLower.has(slugLower)) return true;
      if (currentSlug && slugLower === currentSlug.toLowerCase()) return true;
      if (allowedEnded.has(slugLower)) return true;
      const deadline = enteredDeadlines.get(slugLower);
      if (deadline && isCompetitionEnded(deadline)) return false;
      return true;
    })
    .map((slug) => {
      known.add(slug);
      const isDefault = activeSlug && slug.toLowerCase() === activeSlug.toLowerCase();
      const deadline = enteredDeadlines.get(slug.toLowerCase());
      const isEnded = deadline ? isCompetitionEnded(deadline) : false;
      const hint = isDefault
        ? (isEnded ? '全站主攻 · 迟提交 / 已完赛' : '全站主攻')
        : (isEnded ? '迟提交 / 已完赛' : '已保存');
      return {
        value: slug,
        label: competitionOptionLabel(slug, hint),
      };
    });

  return [...fromEntered, ...extraOptions];
}
