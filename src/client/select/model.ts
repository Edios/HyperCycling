import type { Lang } from '../../domain/lang';
import { totalDurationSec, type Workout } from '../../domain/workout';
import { localizedText } from '../data/localized';
import type { MessageKey } from '../i18n';

export type FilterId = 'all' | 'short' | 'hiit' | 'zone2' | 'climbs' | 'tests' | 'music' | 'mine';

export const FILTER_IDS: readonly FilterId[] = [
  'all',
  'short',
  'hiit',
  'zone2',
  'climbs',
  'tests',
  'music',
  'mine',
];

export const SHORT_WORKOUT_SEC = 30 * 60;

const TAG_FILTERS: Partial<Record<FilterId, string>> = {
  hiit: 'hiit',
  zone2: 'endurance',
  climbs: 'climb',
  tests: 'test',
  music: 'music',
  mine: 'mine',
};

/** Lower-case, strip diacritics (the Polish l with stroke does not decompose, so map it). */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/gi, 'l').toLowerCase().trim();
}

export function filterLibrary(
  workouts: readonly Workout[],
  filter: FilterId,
  query: string,
  lang: Lang,
): Workout[] {
  const q = normalizeText(query);
  return workouts.filter((w) => {
    if (filter === 'short') {
      if (totalDurationSec(w) > SHORT_WORKOUT_SEC) return false;
    } else {
      const tag = TAG_FILTERS[filter];
      if (tag !== undefined && !w.tags.includes(tag)) return false;
    }
    if (q === '') return true;
    return normalizeText(localizedText(w, lang).name).includes(q);
  });
}

/** Tags in priority order for the label on a card. */
const TAG_PRIORITY = [
  'hiit',
  'test',
  'music',
  'climb',
  'sprint',
  'cadence',
  'endurance',
  'tempo',
  'sweetspot',
  'threshold',
  'vo2',
  'recovery',
] as const;

export type PrimaryTag = 'mine' | 'progres' | 'freestyle' | (typeof TAG_PRIORITY)[number];

export function primaryTag(w: Workout): PrimaryTag {
  if (w.tags.includes('mine')) return 'mine';
  if (w.category === 'progres') return 'progres';
  return TAG_PRIORITY.find((t) => w.tags.includes(t)) ?? 'freestyle';
}

export function tagKey(tag: PrimaryTag): MessageKey {
  return `tag.${tag}`;
}

export function minutesOf(w: Workout): number {
  return Math.round(totalDurationSec(w) / 60);
}
