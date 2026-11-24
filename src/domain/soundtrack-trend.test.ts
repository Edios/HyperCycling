import { describe, expect, it } from 'vitest';
import { builtinWorkouts } from '../client/data/builtin';
import rawCatalog from '../content/soundtrack/catalog.json';
import type { EffortLevel } from './effort';
import { sectionsOf, trendEnergyAt, type MusicSection } from './soundtrack';
import { parseCatalog, type CatalogTrack } from './soundtrack-catalog';
import { planSoundtrack } from './soundtrack-plan';
import { FIRST_VISIT_PREFS } from './soundtrack-wizard';
import type { Block, RampBlock, SteadyBlock, Workout } from './workout';

/** R1d-1: a ramp or a pyramid inside one part is a trend, and the songs follow it (spec §8). */

const steady = (id: string, sec: number, effort: number, rpm = 90): SteadyBlock => ({
  kind: 'steady',
  id,
  durationSec: sec,
  intensity: { effort: effort as EffortLevel },
  rpm,
});
const ramp = (id: string, sec: number, from: number, to: number, rpm = 90): RampBlock => ({
  kind: 'ramp',
  id,
  durationSec: sec,
  from: { effort: from as EffortLevel },
  to: { effort: to as EffortLevel },
  rpm,
});
const workout = (blocks: Block[]): Workout => ({
  id: 'w',
  name: 'W',
  description: '',
  category: 'freestyle',
  tags: [],
  source: { kind: 'user' },
  blocks,
  musicCues: [],
  fallbackPlaylist: [],
  schemaVersion: 1,
  updatedAt: '2026-11-24T00:00:00.000Z',
});
const wrap = (...mid: Block[]): Workout =>
  workout([ramp('wu', 300, 2, 4), ...mid, ramp('cd', 300, 4, 1, 80)]);
const trendOf = (w: Workout): MusicSection['trend'] =>
  sectionsOf(w).find((s) => s.trend !== undefined)?.trend;

describe('trend detection in sectionsOf', () => {
  it('reads a long ramp up as "up", a ramp down as "down"', () => {
    expect(trendOf(wrap(ramp('r', 720, 4, 9)))?.kind).toBe('up');
    expect(trendOf(wrap(ramp('r', 720, 9, 4)))?.kind).toBe('down');
  });

  it('reads a pyramid (up, then down) as "pyramid"', () => {
    expect(trendOf(wrap(ramp('u', 240, 4, 9), ramp('d', 240, 9, 4)))?.kind).toBe('pyramid');
  });

  it('has no trend for a steady part, a tiny ramp, or a ramp too short for two songs', () => {
    expect(trendOf(wrap(steady('a', 720, 6)))).toBeUndefined();
    expect(trendOf(wrap(ramp('r', 720, 5, 6)))).toBeUndefined();
    expect(trendOf(wrap(ramp('r', 240, 4, 9)))).toBeUndefined();
  });

  it('has no trend for the warm-up and the cool-down, nor for short intervals', () => {
    const sections = sectionsOf(wrap(steady('a', 600, 5)));
    expect(sections.every((s) => s.trend === undefined)).toBe(true);
    const intervals = wrap({
      kind: 'repeat',
      id: 'rp',
      times: 8,
      blocks: [ramp('on', 15, 9, 10, 105), steady('off', 20, 2, 70)],
    });
    expect(sectionsOf(intervals).every((s) => s.trend === undefined)).toBe(true);
  });

  it('gives an energy that rises along an up trend and falls along a down trend', () => {
    const up = trendOf(wrap(ramp('r', 720, 3, 10))) as NonNullable<MusicSection['trend']>;
    expect(trendEnergyAt(up, 0, 0.2)).toBeLessThan(trendEnergyAt(up, 0.8, 1));
    const down = trendOf(wrap(ramp('r', 720, 10, 3))) as NonNullable<MusicSection['trend']>;
    expect(trendEnergyAt(down, 0, 0.2)).toBeGreaterThan(trendEnergyAt(down, 0.8, 1));
  });
});

// --- the planner follows the trend -----------------------------------------------------------

let seq = 0;
function song(energy: number): CatalogTrack {
  const id = `t${seq++}`;
  return {
    id,
    artist: `Artist ${id}`,
    title: `Title ${id}`,
    durationSec: 180,
    categories: ['electronic'],
    roles: ['steady', 'climb', 'intervals'],
    energy: energy as CatalogTrack['energy'],
    beat: 'steady',
    bpm: 180,
    clean: true,
    verified: '2026-11-24',
    youtube: [
      { id: `up${String(seq).padStart(9, '0')}`, durationSec: 180 },
      { id: `uq${String(seq).padStart(9, '0')}`, durationSec: 180 },
    ],
  };
}
const synthetic: CatalogTrack[] = [1, 2, 3, 4, 5].flatMap((e) => [song(e), song(e), song(e)]);
const byId = new Map(synthetic.map((t) => [t.id, t]));

function energiesOf(w: Workout, index: number): number[] {
  const plan = planSoundtrack(w, synthetic, FIRST_VISIT_PREFS);
  const sec = sectionsOf(w).filter((s) => s.trend !== undefined)[index] as MusicSection;
  const planned = plan.sections.find((s) => s.sectionId === sec.id);
  return (planned?.picks ?? []).map((p) => (byId.get(p.ref.id) as CatalogTrack).energy);
}

describe('the plan follows the trend', () => {
  it('a ramp up plays songs of rising energy, no jump over one step', () => {
    const e = energiesOf(wrap(ramp('r', 720, 3, 10)), 0);
    expect(e.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < e.length; i++) {
      expect(e[i] as number).toBeGreaterThanOrEqual(e[i - 1] as number);
      expect((e[i] as number) - (e[i - 1] as number)).toBeLessThanOrEqual(1);
    }
    expect(e[e.length - 1] as number).toBeGreaterThan(e[0] as number);
  });

  it('a ramp down plays songs of falling energy', () => {
    const e = energiesOf(wrap(ramp('r', 720, 10, 3)), 0);
    for (let i = 1; i < e.length; i++) {
      expect(e[i] as number).toBeLessThanOrEqual(e[i - 1] as number);
      expect((e[i - 1] as number) - (e[i] as number)).toBeLessThanOrEqual(1);
    }
    expect(e[0] as number).toBeGreaterThan(e[e.length - 1] as number);
  });

  it('a pyramid climbs to its top song and comes down again', () => {
    const e = energiesOf(wrap(ramp('u', 300, 3, 10), ramp('d', 300, 10, 3)), 0);
    const top = e.indexOf(Math.max(...e));
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(e.length - 1);
    for (let i = 1; i <= top; i++)
      expect(e[i] as number).toBeGreaterThanOrEqual(e[i - 1] as number);
    for (let i = top + 1; i < e.length; i++)
      expect(e[i] as number).toBeLessThanOrEqual(e[i - 1] as number);
  });
});

// --- the real workouts -----------------------------------------------------------------------

const catalog = parseCatalog(rawCatalog).tracks;

describe('on the built-in workouts', () => {
  it('finds a trend in some parts and keeps every plan whole', () => {
    let trending = 0;
    for (const w of builtinWorkouts) {
      const sections = sectionsOf(w);
      trending += sections.filter((s) => s.trend !== undefined).length;
      const plan = planSoundtrack(w, catalog, FIRST_VISIT_PREFS);
      for (const s of plan.sections) expect(s.report.gapSec).toBeLessThanOrEqual(30);
    }
    expect(trending).toBeGreaterThan(0);
  });
});
