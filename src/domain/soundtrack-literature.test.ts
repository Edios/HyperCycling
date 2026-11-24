import { describe, expect, it } from 'vitest';
import { builtinWorkouts } from '../client/data/builtin';
import rawCatalog from '../content/soundtrack/catalog.json';
import { BPM_MAX, BPM_MIN, cadenceHints, matchBpm } from './bpm-match';
import { sectionsOf, type MusicSection } from './soundtrack';
import { parseCatalog, type CatalogTrack } from './soundtrack-catalog';
import {
  BAND_BONUS,
  comfortBand,
  planSoundtrack,
  preferredKind,
  scoreTrack,
} from './soundtrack-plan';
import { FIRST_VISIT_PREFS } from './soundtrack-wizard';

/**
 * R1e: what the literature review changes in the fit (music energy spec §9, A, B, C and E).
 * The numbers are the spec's proposals (to tune on the owner's rides), not research results.
 */

let seq = 0;
function song(bpm: number, over: Partial<CatalogTrack> = {}): CatalogTrack {
  const id = `s${seq++}`;
  return {
    id,
    artist: `Artist ${id}`,
    title: `Title ${id}`,
    durationSec: 200,
    categories: ['electronic'],
    roles: ['steady', 'climb', 'intervals'],
    energy: 3,
    beat: 'steady',
    bpm,
    clean: true,
    verified: '2026-11-24',
    youtube: [
      { id: `up${String(seq).padStart(9, '0')}`, durationSec: 200 },
      { id: `uq${String(seq).padStart(9, '0')}`, durationSec: 200 },
    ],
    ...over,
  };
}

const section = (over: Partial<MusicSection> = {}): MusicSection => ({
  id: 's1',
  anchor: { blockId: 'a', rep: 1 },
  startSec: 0,
  durationSec: 300,
  blockRefs: [{ blockId: 'a', rep: 1 }],
  role: 'steady',
  effort: { min: 5, max: 5, mean: 5 },
  rpmMean: 90,
  rpmKnown: true,
  targetBpm: 180,
  energy: 3,
  profile: 'steady',
  workEffort: 5,
  ...over,
});

const score = (t: CatalogTrack, s: MusicSection): number => scoreTrack(t, s)?.score ?? -1;

describe('A: the tempo penalty is flat within 3%, then grows gently', () => {
  it('scores a song up to 3% off as well as one on the beat', () => {
    expect(matchBpm(185, 90)?.score).toBe(matchBpm(180, 90)?.score);
    expect(matchBpm(175, 90)?.score).toBe(1);
  });

  it('has no cliff past 3%: 3.3% off still scores at least 0.95', () => {
    expect(matchBpm(186, 90)?.score).toBeGreaterThanOrEqual(0.95);
  });

  it('falls step by step with the distance, and never below zero inside the window', () => {
    const at = (dev: number) => matchBpm(180 * (1 + dev), 90, { tolerance: 0.1 })?.score ?? -1;
    expect(at(0.04)).toBeGreaterThan(at(0.05));
    expect(at(0.05)).toBeGreaterThan(at(0.06));
    expect(at(0.06)).toBeGreaterThan(at(0.09));
    expect(at(0.09)).toBeGreaterThan(0);
  });

  it('keeps the windows: the editor hints stay exact inverses of matchBpm (40-220 BPM)', () => {
    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm++) {
      for (const h of cadenceHints(bpm)) {
        for (let rpm = h.lo; rpm <= h.hi; rpm++) expect(matchBpm(bpm, rpm)).toBeDefined();
      }
      for (let rpm = 50; rpm <= 130; rpm++) {
        if (!matchBpm(bpm, rpm)) continue;
        expect(cadenceHints(bpm).some((h) => rpm >= h.lo && rpm <= h.hi)).toBe(true);
      }
    }
  });
});

describe('B: the comfort band 120-140 BPM', () => {
  it('is 120-140, up to 160 in hard work (zone 4 and up), up to 150 on a climb', () => {
    expect(comfortBand(section())).toEqual([120, 140]);
    expect(comfortBand(section({ role: 'hard', workEffort: 7, energy: 4 }))).toEqual([120, 160]);
    expect(comfortBand(section({ rpmMean: 70, workEffort: 6, energy: 3 }))).toEqual([120, 150]);
  });

  it('picks the relation whose tempo is nearest the band: 1:1 at 90 rpm when easy, 2x when hard', () => {
    expect(preferredKind(section({ rpmMean: 90 }))).toBe('half');
    expect(preferredKind(section({ rpmMean: 90, role: 'hard', workEffort: 7, energy: 4 }))).toBe(
      'exact',
    );
    expect(preferredKind(section({ rpmMean: 65 }))).toBe('exact');
  });

  it('so at 90 rpm in a steady part a 90 BPM song now beats a 180 BPM one', () => {
    const s = section({ rpmMean: 90 });
    expect(score(song(90), s)).toBeGreaterThan(score(song(180), s));
  });

  it('gives a song inside the band a bonus on top of the preferred relation', () => {
    const s = section({ rpmMean: 66, targetBpm: 132 });
    expect(score(song(132), s) - score(song(66), s)).toBeGreaterThanOrEqual(
      0.4 * 0.15 + BAND_BONUS - 1e-9,
    );
    expect(BAND_BONUS).toBeCloseTo(0.05);
  });
});

describe('C: no slow song in the work', () => {
  it('never plays an energy 1-2 song in a work part (energy 3 and up, not warm-up/cool-down)', () => {
    expect(scoreTrack(song(180, { energy: 2 }), section({ energy: 3 }))).toBeUndefined();
    expect(
      scoreTrack(song(180, { energy: 2 }), section({ role: 'hard', energy: 4, workEffort: 7 })),
    ).toBeUndefined();
  });

  it('still lets an energy 2 song play in a recovery part, the warm-up and the cool-down', () => {
    expect(scoreTrack(song(180, { energy: 2 }), section({ energy: 2 }))).toBeDefined();
    expect(
      scoreTrack(song(180, { energy: 2 }), section({ role: 'warmup', energy: 3 })),
    ).toBeDefined();
  });

  it('leaves no energy 1-2 song in a work part of any first-visit plan (the old planner: 155)', () => {
    const catalog = parseCatalog(rawCatalog).tracks;
    const byId = new Map(catalog.map((t) => [t.id, t]));
    const slow: string[] = [];
    for (const w of builtinWorkouts) {
      const secs = new Map(sectionsOf(w).map((s) => [s.id, s]));
      for (const s of planSoundtrack(w, catalog, FIRST_VISIT_PREFS).sections) {
        const sec = secs.get(s.sectionId);
        if (!sec || sec.role === 'warmup' || sec.role === 'cooldown' || sec.energy < 3) continue;
        for (const p of s.picks) {
          if ((byId.get(p.ref.id)?.energy ?? 5) <= 2) slow.push(`${w.id}/${p.ref.id}`);
        }
      }
    }
    expect(slow).toEqual([]);
  });
});

describe('E: a climb at 60-75 rpm takes double the cadence (2x), aimed at 120-150 BPM', () => {
  it('prefers 2x on every climb cadence from 60 to 75 rpm', () => {
    for (let rpm = 60; rpm <= 75; rpm++) {
      expect(preferredKind(section({ rpmMean: rpm, workEffort: 6, energy: 3 })), `${rpm}`).toBe(
        'exact',
      );
    }
  });

  it('gives a 148 BPM song on a 74 rpm climb the band bonus (the plain band ends at 140)', () => {
    const climb = section({ rpmMean: 74, targetBpm: 148, workEffort: 6, energy: 3 });
    expect(score(song(148), climb) - score(song(74), climb)).toBeGreaterThanOrEqual(
      0.4 * 0.15 + BAND_BONUS - 1e-9,
    );
  });
});
