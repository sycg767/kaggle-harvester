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

export function buildEnteredCompetitionOptions(
  entered: EnteredCompetition[],
  extras: Array<string | undefined | null> = [],
): Array<{ value: string; label: string }> {
  const fromEntered = entered.map((item) => ({
    value: item.id,
    label: competitionOptionLabel(item),
  }));
  const known = new Set(fromEntered.map((item) => item.value));
  const extraOptions = extras
    .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
    .filter((slug) => !known.has(slug))
    .map((slug) => {
      known.add(slug);
      return {
        value: slug,
        label: competitionOptionLabel(slug, '已保存'),
      };
    });
  return [...fromEntered, ...extraOptions];
}
