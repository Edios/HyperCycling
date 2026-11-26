import type { Lang } from '../../domain/lang';
import type { Segment } from '../../domain/segments';
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

export type GroupId = 'recommended' | 'short' | 'hiit' | 'mine' | 'rest';

/** The order of the groups on screen (audit N-09); the rest comes last. */
export const GROUP_IDS: readonly GroupId[] = ['recommended', 'short', 'hiit', 'mine', 'rest'];

/** Rows a group shows before "Show more". */
export const GROUP_LIMIT = 5;

/**
 * The unfiltered library in groups, each workout in exactly one (so rows and keyboard focus stay
 * unique): own workouts in Mine; ready classes with music in Recommended; then HIIT; then up to
 * 30 minutes in Short; everything else in Rest. Library order inside a group; empty groups dropped.
 */
export function groupLibrary(workouts: readonly Workout[]): { id: GroupId; workouts: Workout[] }[] {
  const of = (w: Workout): GroupId => {
    if (w.source.kind === 'user' || w.tags.includes('mine')) return 'mine';
    if (w.tags.includes('music')) return 'recommended';
    if (w.tags.includes('hiit')) return 'hiit';
    if (totalDurationSec(w) <= SHORT_WORKOUT_SEC) return 'short';
    return 'rest';
  };
  const by = new Map<GroupId, Workout[]>(GROUP_IDS.map((g) => [g, []]));
  for (const w of workouts) by.get(of(w))?.push(w);
  return GROUP_IDS.flatMap((id) => {
    const list = by.get(id) ?? [];
    return list.length > 0 ? [{ id, workouts: list }] : [];
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

/**
 * Difficulty 1..10 derived from the effort profile: the mean of the time-weighted average effort
 * and the peak effort, so a long easy ride with one hard block still reads above a pure endurance one.
 */
export function difficultyOf(segments: readonly Segment[]): number {
  let total = 0;
  let weighted = 0;
  let peak = 1;
  for (const s of segments) {
    total += s.durationSec;
    weighted += ((s.effortStart + s.effortEnd) / 2) * s.durationSec;
    peak = Math.max(peak, s.effortStart, s.effortEnd);
  }
  if (total === 0) return 1;
  return Math.min(10, Math.max(1, Math.round((weighted / total + peak) / 2)));
}

/** Distinct, non-empty "what to look for" music hints of a workout. */
export function musicHintsOf(w: Workout): string[] {
  return [...new Set(Object.values(w.musicHints ?? {}).map((h) => h.trim()))].filter(
    (h) => h !== '',
  );
}

const HARD_TAGS: readonly PrimaryTag[] = ['hiit', 'vo2', 'sprint', 'threshold', 'climb', 'test'];
const EASY_TAGS: readonly PrimaryTag[] = ['endurance', 'recovery'];
/** A hint only makes sense for a recent ride. */
export const ROTATION_HINT_DAYS = 3;

export interface RotationHint {
  /** What the last ride was (its card tag). */
  last: PrimaryTag;
  /** The filter chip that shows the suggested kind of day. */
  filter: FilterId;
}

/**
 * A light "what next" nudge for Freestyle, not a generator: after a hard ride suggest an easy one,
 * after an easy ride something sharper; nothing for middling sessions, old rides or own workouts.
 */
export function rotationHint(
  last: Workout | undefined,
  endedAt: string | undefined,
  now: number,
): RotationHint | null {
  if (!last || endedAt === undefined) return null;
  const age = now - Date.parse(endedAt);
  if (!Number.isFinite(age) || age > ROTATION_HINT_DAYS * 86_400_000) return null;
  const tag = primaryTag(last);
  if (HARD_TAGS.includes(tag)) return { last: tag, filter: 'zone2' };
  if (EASY_TAGS.includes(tag)) return { last: tag, filter: 'hiit' };
  return null;
}

/** A ride stopped after seconds is not what the rider did that day; finished or 10+ minutes counts. */
export function countsAsRide(log: { completed: boolean; riddenSec: number }): boolean {
  return log.completed || log.riddenSec >= 10 * 60;
}
