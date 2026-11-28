import type { Segment } from '../../domain/segments';
import { describe, expect, it } from 'vitest';
import type { Workout } from '../../domain/workout';
import { builtinWorkouts } from '../data/builtin';
import { en } from '../i18n/en';
import { pl } from '../i18n/pl';
import {
  countsAsRide,
  difficultyOf,
  filterLibrary,
  groupLibrary,
  normalizeText,
  primaryTag,
  rotationHint,
} from './model';

const base = builtinWorkouts[0] as Workout;
const make = (over: Partial<Workout>): Workout => ({ ...base, ...over });
const block = (durationSec: number): Workout['blocks'] => [
  { kind: 'steady', id: 'x', durationSec, intensity: { effort: 4 } },
];

describe('normalizeText', () => {
  it('ignores case and diacritics, including the Polish l with stroke', () => {
    expect(normalizeText('Łagodny Podjazd ŻÓŁĆ')).toBe('lagodny podjazd zolc');
  });
});

describe('filterLibrary', () => {
  const hiit = make({ id: 'a', name: 'Tabata', tags: ['hiit'] });
  const z2 = make({
    id: 'b',
    name: 'Calm',
    tags: ['endurance'],
    localized: { pl: { name: 'Spokojna dwójka', description: '' } },
  });
  const mine = make({
    id: 'c',
    name: 'Mine one',
    tags: ['mine', 'climb'],
    source: { kind: 'user' },
  });
  const all = [hiit, z2, mine];

  it('all keeps everything', () => {
    expect(filterLibrary(all, 'all', '', 'en')).toHaveLength(3);
  });

  it('filters by tag', () => {
    expect(filterLibrary(all, 'hiit', '', 'en').map((w) => w.id)).toEqual(['a']);
    expect(filterLibrary(all, 'zone2', '', 'en').map((w) => w.id)).toEqual(['b']);
    expect(filterLibrary(all, 'climbs', '', 'en').map((w) => w.id)).toEqual(['c']);
    expect(filterLibrary(all, 'mine', '', 'en').map((w) => w.id)).toEqual(['c']);
  });

  it('short filter keeps workouts of at most 30 minutes', () => {
    const long = make({ id: 'long', blocks: block(3600) });
    const short = make({ id: 'short', blocks: block(1800) });
    expect(filterLibrary([long, short], 'short', '', 'en').map((w) => w.id)).toEqual(['short']);
  });

  it('"Easy start" keeps up to 45 minutes and none of the hard kinds', () => {
    const easy = make({ id: 'easy', tags: ['endurance'], blocks: block(40 * 60) });
    const long = make({ id: 'long', tags: ['endurance'], blocks: block(50 * 60) });
    const hard = make({ id: 'hard', tags: ['hiit'], blocks: block(20 * 60) });
    const test = make({ id: 'test', tags: ['test'], blocks: block(20 * 60) });
    expect(filterLibrary([easy, long, hard, test], 'start', '', 'en').map((w) => w.id)).toEqual([
      'easy',
    ]);
  });

  it('"Easy start" finds something in the built-in library, and nothing hard', () => {
    const picked = filterLibrary(builtinWorkouts, 'start', '', 'en');
    expect(picked.length).toBeGreaterThanOrEqual(5);
    for (const w of picked) expect(w.tags).not.toContain('hiit');
  });

  it('every card kind has a plain-words effect in both languages', () => {
    for (const tag of [
      ...new Set(builtinWorkouts.map(primaryTag)),
      'mine',
      'progres',
      'freestyle',
    ] as const) {
      expect(en.tagEffect[tag as keyof typeof en.tagEffect], tag).toBeTruthy();
      expect(pl.tagEffect[tag as keyof typeof pl.tagEffect], tag).toBeTruthy();
    }
  });

  it('searches the localized name without caring about case or diacritics', () => {
    expect(filterLibrary(all, 'all', 'DWOJKA', 'pl').map((w) => w.id)).toEqual(['b']);
    expect(filterLibrary(all, 'all', 'dwójka', 'en')).toEqual([]);
  });

  it('combines filter and search', () => {
    expect(filterLibrary(all, 'hiit', 'calm', 'en')).toEqual([]);
  });
});

describe('primaryTag', () => {
  it('prefers mine, then progres category, then the first known tag', () => {
    expect(primaryTag(make({ tags: ['mine', 'hiit'] }))).toBe('mine');
    expect(primaryTag(make({ category: 'progres', tags: ['hiit'] }))).toBe('progres');
    expect(primaryTag(make({ category: 'freestyle', tags: ['hiit'] }))).toBe('hiit');
    expect(primaryTag(make({ category: 'freestyle', tags: [] }))).toBe('freestyle');
  });
});

describe('difficultyOf', () => {
  const seg = (durationSec: number, e: number) =>
    ({ durationSec, effortStart: e, effortEnd: e }) as unknown as Segment;
  it('is 1 for nothing and for easy riding', () => {
    expect(difficultyOf([])).toBe(1);
    expect(difficultyOf([seg(600, 1)])).toBe(1);
  });
  it('blends mean and peak effort, capped at 10', () => {
    expect(difficultyOf([seg(600, 4), seg(600, 8)])).toBe(7);
    expect(difficultyOf([seg(60, 10)])).toBe(10);
  });
});

describe('rotationHint (R4b)', () => {
  const NOW = Date.parse('2026-11-25T12:00:00Z');
  const daysAgo = (d: number): string => new Date(NOW - d * 86_400_000).toISOString();
  const vo2 = make({ id: 'v', tags: ['vo2'] });
  const z2 = make({ id: 'z', tags: ['endurance'] });
  const tempo = make({ id: 't', tags: ['tempo'] });
  const mineWk = make({ id: 'm', tags: ['mine', 'vo2'] });

  it('suggests an easier day after a hard one', () => {
    expect(rotationHint(vo2, daysAgo(1), NOW)).toEqual({ last: 'vo2', filter: 'zone2' });
  });
  it('suggests something sharper after an easy day', () => {
    expect(rotationHint(z2, daysAgo(1), NOW)).toEqual({ last: 'endurance', filter: 'hiit' });
  });
  it('stays quiet after a middling session, an old ride or no ride', () => {
    expect(rotationHint(tempo, daysAgo(1), NOW)).toBeNull();
    expect(rotationHint(vo2, daysAgo(5), NOW)).toBeNull();
    expect(rotationHint(undefined, undefined, NOW)).toBeNull();
  });
  it('does not guess for the rider own workouts', () => {
    expect(rotationHint(mineWk, daysAgo(1), NOW)).toBeNull();
  });
});

describe('countsAsRide (R4b review)', () => {
  it('ignores a ride stopped after a few seconds', () => {
    expect(countsAsRide({ completed: false, riddenSec: 10 })).toBe(false);
    expect(countsAsRide({ completed: false, riddenSec: 600 })).toBe(true);
    expect(countsAsRide({ completed: true, riddenSec: 30 })).toBe(true);
  });
});

describe('groupLibrary (audit N-09)', () => {
  it('puts each workout in exactly one group, in screen order, without empty groups', () => {
    const music = make({ id: 'm', tags: ['music', 'hiit'], blocks: block(1200) });
    const hiit = make({ id: 'h', tags: ['hiit'], blocks: block(1200) });
    const short = make({ id: 's', tags: ['endurance'], blocks: block(1500) });
    const long = make({ id: 'l', tags: ['endurance'], blocks: block(3600) });
    const mine = make({ id: 'u', tags: ['music'], source: { kind: 'user' }, blocks: block(600) });
    const groups = groupLibrary([long, mine, short, hiit, music]);
    expect(groups.map((g) => [g.id, g.workouts.map((w) => w.id)])).toEqual([
      ['recommended', ['m']],
      ['short', ['s']],
      ['hiit', ['h']],
      ['mine', ['u']],
      ['rest', ['l']],
    ]);
    expect(groupLibrary([long]).map((g) => g.id)).toEqual(['rest']);
  });

  it('covers the whole built-in library once', () => {
    const ids = groupLibrary(builtinWorkouts).flatMap((g) => g.workouts.map((w) => w.id));
    expect(ids).toHaveLength(builtinWorkouts.length);
    expect(new Set(ids).size).toBe(builtinWorkouts.length);
  });
});
