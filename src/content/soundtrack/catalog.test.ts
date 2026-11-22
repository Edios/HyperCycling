import { describe, expect, it } from 'vitest';
import { builtinWorkouts } from '../../client/data/builtin';
import { BPM_CLOSE, BPM_RELAXED, matchBpm } from '../../domain/bpm-match';
import { songKey } from '../../domain/slot-plan';
import {
  bestCategories,
  CATEGORY_TEMPO,
  coverage,
  MUSIC_CATEGORIES,
  sectionsOf,
  type MusicCategoryId,
} from '../../domain/soundtrack';
import {
  catalogProblems,
  catalogRpm,
  parseCatalog,
  ROLE_SPRINT_RPM,
  type CatalogTrack,
} from '../../domain/soundtrack-catalog';
import raw from './catalog.json';

/** Content contract of the shipped catalog (soundtrack spec §5.2, §12, §13.2) and owner's rules. */
const tracks: CatalogTrack[] = parseCatalog(raw).tracks;

const inCategory = (c: MusicCategoryId) => tracks.filter((t) => t.categories.includes(c));
const byArtist = (re: RegExp) => tracks.filter((t) => re.test(t.artist));
const fits = (t: CatalogTrack, rpm: number) => matchBpm(t.bpm, rpm, { tolerance: BPM_CLOSE });

/** Fewest songs per category. The spec aims at 12; lo-fi (9), hip-hop and Latino (10) are short. */
const MIN_PER_CATEGORY = 8;
/** Polish songs are a fixed part of the mix. The approved list has 17 (the brief said 20). */
const MIN_PL = 17;
/** Cadences the wizard plans for, every 5 rpm. */
const RPMS = Array.from({ length: 14 }, (_, i) => 60 + i * 5); // 60..125
/** Songs that fit each cadence across the catalog (exact, half or double time, 6% window). */
const MIN_FITS_PER_RPM = 8;

describe('soundtrack catalog: contract', () => {
  it('is the approved selection: about 150 valid songs with no cross-entry problems', () => {
    expect(tracks.length).toBeGreaterThanOrEqual(150);
    expect(catalogProblems(tracks)).toEqual([]);
  });

  it('gives every song at least two uploads, the main one as long as the song', () => {
    for (const t of tracks) {
      expect(t.youtube.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.youtube[0]!.durationSec, t.id).toBe(t.durationSec);
    }
  });

  it('has only metadata and YouTube ids: no Spotify ids, URLs or helper fields', () => {
    const text = JSON.stringify(raw);
    expect(text).not.toMatch(/spotify|https?:|_proposal|popularity/i);
  });

  it('keeps tempo and length plausible for a ride', () => {
    for (const t of tracks) {
      expect(t.bpm, t.id).toBeGreaterThanOrEqual(50);
      expect(t.bpm, t.id).toBeLessThanOrEqual(200);
      expect(t.durationSec, t.id).toBeGreaterThanOrEqual(120);
      expect(t.durationSec, t.id).toBeLessThanOrEqual(600);
    }
  });

  it('uses every energy level from calm to peak', () => {
    const levels = new Set(tracks.map((t) => t.energy));
    expect([...levels].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(tracks.filter((t) => t.energy === 5).length).toBeGreaterThanOrEqual(20);
  });

  it('marks explicit songs, most of the catalog is clean', () => {
    const explicit = tracks.filter((t) => !t.clean).length;
    expect(explicit).toBeGreaterThan(0);
    expect(explicit / tracks.length).toBeLessThan(0.2);
  });
});

describe("soundtrack catalog: owner's rules", () => {
  it(`has at least ${MIN_PER_CATEGORY} songs in every category`, () => {
    for (const c of MUSIC_CATEGORIES) {
      expect(inCategory(c).length, c).toBeGreaterThanOrEqual(MIN_PER_CATEGORY);
    }
  });

  it(`has at least ${MIN_PL} Polish songs`, () => {
    expect(tracks.filter((t) => t.pl).length).toBeGreaterThanOrEqual(MIN_PL);
  });

  it('has Daft Punk (more, as asked) and The Prodigy', () => {
    expect(byArtist(/^Daft Punk$/).length).toBeGreaterThanOrEqual(8);
    expect(byArtist(/^The Prodigy$/).length).toBeGreaterThanOrEqual(3);
  });

  it('leaves out the vetoed Last Christmas', () => {
    expect(tracks.some((t) => t.id === 'wham-last-christmas')).toBe(false);
    expect(
      tracks.some((t) => songKey(t) === songKey({ artist: 'Wham!', title: 'Last Christmas' })),
    ).toBe(false);
  });

  it('gives a song ridden at 105 rpm or faster only the intervals role', () => {
    const fast = tracks.filter((t) => catalogRpm(t.bpm) >= ROLE_SPRINT_RPM);
    expect(fast.length).toBeGreaterThan(0);
    for (const t of fast) expect(t.roles, t.id).toEqual(['intervals']);
  });

  it('files dance-house at half tempo under Pop/Electronic, not House', () => {
    for (const id of ['kygo-stole-the-show', 'alan-walker-faded', 'robert-miles-children']) {
      const t = tracks.find((x) => x.id === id);
      expect(t?.categories, id).not.toContain('house');
      expect(t?.categories, id).toContain('electronic');
    }
    // House is four-on-the-floor at full speed: nothing slow under it.
    for (const t of inCategory('house')) expect(t.bpm, t.id).toBeGreaterThanOrEqual(105);
  });
});

describe('soundtrack catalog: tempo coverage (spec §12)', () => {
  it(`fits every cadence from 60 to 125 rpm with at least ${MIN_FITS_PER_RPM} songs`, () => {
    for (const rpm of RPMS) {
      const n = tracks.filter((t) => fits(t, rpm)).length;
      expect(n, `${rpm} rpm`).toBeGreaterThanOrEqual(MIN_FITS_PER_RPM);
    }
  });

  it('spreads the songs over the riding cadences, 60 to 129 rpm in steps of 10', () => {
    for (let lo = 60; lo < 130; lo += 10) {
      const n = tracks.filter((t) => catalogRpm(t.bpm) >= lo && catalogRpm(t.bpm) < lo + 10).length;
      expect(n, `${lo}-${lo + 9} rpm`).toBeGreaterThanOrEqual(20);
    }
  });

  it('has three songs per category at each cadence typical of it, except the known gaps', () => {
    // Typical = one of the cadence's target tempos (exact 2x or half time 1x) is in the
    // category's usual range. The gaps below are content work for the owner (§17 of the spec).
    const gaps: string[] = [];
    for (const rpm of RPMS) {
      for (const c of MUSIC_CATEGORIES) {
        const typical = CATEGORY_TEMPO[c].some(([lo, hi]) =>
          [2 * rpm, rpm].some((bpm) => bpm >= lo && bpm <= hi),
        );
        if (!typical) continue;
        const n = inCategory(c).filter((t) => fits(t, rpm)).length;
        if (n < 3) gaps.push(`${c}@${rpm}`);
      }
    }
    expect(gaps).toEqual(KNOWN_TEMPO_GAPS);
  });
});

/**
 * Category and cadence pairs with fewer than three fitting songs (see the test above). Hip-hop and
 * lo-fi are small and slow, nothing electronic sits at 160 or 80 BPM, Latino has few fast songs.
 * Adding songs should shrink this list; a new entry means a song that held a cadence was removed.
 */
const KNOWN_TEMPO_GAPS: string[] = [
  'hiphop@65',
  'hiphop@70',
  'hiphop@75',
  'lofi@75',
  'electronic@80',
  'hiphop@80',
  'lofi@80',
  'hiphop@85',
  'lofi@85',
  'hiphop@90',
  'lofi@90',
  'latino@105',
];

describe('soundtrack catalog with coverage() on built-in workouts', () => {
  const workout = (id: string) => {
    const w = builtinWorkouts.find((x) => x.id === id);
    if (!w) throw new Error(id);
    return w;
  };
  const count = (id: string, c: MusicCategoryId) =>
    coverage(sectionsOf(workout(id)), tracks).find((x) => x.category === c)!.tracks;

  it('offers songs for a steady 90 rpm ride in the big categories', () => {
    for (const id of ['zone2-60', 'recovery-30']) {
      expect(count(id, 'electronic'), id).toBeGreaterThanOrEqual(10);
      expect(count(id, 'pop'), id).toBeGreaterThanOrEqual(8);
      expect(count(id, 'rock'), id).toBeGreaterThanOrEqual(5);
    }
  });

  it('suggests the categories that fit the workout best', () => {
    const best = (id: string) => bestCategories(coverage(sectionsOf(workout(id)), tracks));
    expect(best('high-cadence-drills')[0]).toBe('pop');
    expect(best('music-climbs')).toEqual(['rock', 'classics']);
    expect(best('class-endurance-45')).toContain('electronic');
    expect(count('standing-climbs', 'electronic')).toBeGreaterThanOrEqual(5);
  });

  it('counts more songs with a wider tempo window and fewer without half/double time', () => {
    for (const id of ['class-endurance-45', 'music-climbs', 'standing-climbs', 'class-hiit-30']) {
      const s = sectionsOf(workout(id));
      const base = coverage(s, tracks);
      const relaxed = coverage(s, tracks, MUSIC_CATEGORIES, { tolerance: BPM_RELAXED });
      const strict = coverage(s, tracks, MUSIC_CATEGORIES, { halfDouble: false });
      base.forEach((b, i) => {
        expect(relaxed[i]!.tracks, `${id} ${b.category}`).toBeGreaterThanOrEqual(b.tracks);
        expect(strict[i]!.tracks, `${id} ${b.category}`).toBeLessThanOrEqual(b.tracks);
        expect(b.tracks).toBeLessThanOrEqual(inCategory(b.category).length);
      });
    }
  });

  it('leaves no built-in workout without a category, except the known mixed-cadence ones', () => {
    // coverage() asks one song to fit 60% of the time; these alternate ~65 rpm climbs with
    // ~87 rpm flats, so no single song does. The planner (PR 3) picks per section instead.
    const none = builtinWorkouts
      .filter((w) => coverage(sectionsOf(w), tracks).every((c) => c.tracks === 0))
      .map((w) => w.id);
    expect(none).toEqual(['big-gear-ladder', 'class-neon-grid-45', 'demo-mixed']);
  });

  it('has songs for every open section of every built-in workout', () => {
    const thin: string[] = [];
    for (const w of builtinWorkouts) {
      for (const s of sectionsOf(w)) {
        if (s.locked || s.role === 'cooldown') continue;
        const n = tracks.filter((t) => fits(t, s.rpmMean)).length;
        if (n < MIN_FITS_PER_RPM) thin.push(`${w.id}/${s.id} ${s.rpmMean.toFixed(0)} rpm: ${n}`);
      }
    }
    expect(thin).toEqual([]);
  });
});
