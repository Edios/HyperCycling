import { describe, expect, it } from 'vitest';
import type { Workout } from '../../domain/workout';
import { builtinWorkouts } from '../data/builtin';
import { filterLibrary, normalizeText, primaryTag } from './model';

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
