import { describe, expect, it } from 'vitest';
import { builtinWorkouts } from '../../client/data/builtin';
import { BPM_RELAXED, matchBpm } from '../../domain/bpm-match';
import { musicAt } from '../../domain/music-schedule';
import { flattenWorkout } from '../../domain/segments';
import { songKey } from '../../domain/slot-plan';
import { MUSIC_CATEGORIES, type MusicCategoryId } from '../../domain/soundtrack';
import {
  catalogRpm,
  parseCatalog,
  ROLE_SPRINT_RPM,
  type CatalogTrack,
} from '../../domain/soundtrack-catalog';
import { compilePlan } from '../../domain/soundtrack-compile';
import {
  DEFAULT_SOUNDTRACK_PREFS,
  planSoundtrack,
  type SoundtrackPlan,
} from '../../domain/soundtrack-plan';
import { effectiveMusicCues, totalDurationSec, type Workout } from '../../domain/workout';
import raw from './catalog.json';

/** The planner on the shipped catalog and every built-in workout (soundtrack spec §13.1, §15). */
const catalog: CatalogTrack[] = parseCatalog(raw).tracks;
const byId = new Map(catalog.map((t) => [t.id, t]));
const plan = (w: Workout, categories: MusicCategoryId[] = []): SoundtrackPlan =>
  planSoundtrack(w, catalog, { ...DEFAULT_SOUNDTRACK_PREFS, categories });
const workout = (id: string): Workout => {
  const w = builtinWorkouts.find((x) => x.id === id);
  if (!w) throw new Error(id);
  return w;
};

/** Seconds without music outside the closing silence, sampled every `step` seconds. */
function holes(w: Workout, p: SoundtrackPlan, step: number): number[] {
  const compiled = compilePlan(p, w, { catalog });
  const segments = flattenWorkout(w);
  const cues = effectiveMusicCues({ ...w, musicCues: compiled.cues });
  const end = totalDurationSec(w) - (w.silenceLastSec ?? 0);
  const out: number[] = [];
  for (let t = 0; t < end; t += step) {
    if (!musicAt({ segments, cues, fallback: compiled.fallbackPlaylist, tSec: t })) out.push(t);
  }
  return out;
}

describe('soundtrack planner on the built-in workouts', () => {
  const plans = builtinWorkouts.map((w) => ({ w, p: plan(w) }));

  it('gives every section songs and leaves no gap (all categories, "no gaps")', () => {
    expect(plans.length).toBeGreaterThan(100);
    for (const { w, p } of plans) {
      for (const s of p.sections) {
        if (s.locked) continue;
        expect(s.report.warn, `${w.id}/${s.sectionId}`).not.toContain('none');
        expect(s.report.warn, `${w.id}/${s.sectionId}`).not.toContain('gap');
        expect(s.report.warn, `${w.id}/${s.sectionId}`).not.toContain('bpm');
      }
    }
  });

  it('never plays a song twice in a ride and has a Polish song in every ride', () => {
    for (const { w, p } of plans) {
      const songs = p.sections.flatMap((s) => s.picks).map((x) => byId.get(x.ref.id)!);
      // A repeated ending (rule R3) is the same song on purpose: count songs once per section.
      const keys = p.sections.flatMap((s) => [...new Set(s.picks.map((x) => x.ref.id))]);
      expect(new Set(keys.map((id) => songKey(byId.get(id)!))).size, w.id).toBe(keys.length);
      expect(
        songs.some((t) => t.pl),
        w.id,
      ).toBe(true);
    }
  });

  it("keeps the tempo, the sprint rule and the cool-down's rules", () => {
    for (const { w, p } of plans) {
      for (const s of p.sections) {
        for (const pick of s.picks) {
          const t = byId.get(pick.ref.id)!;
          const where = `${w.id}/${s.sectionId}/${t.id}`;
          if (s.role === 'cooldown') {
            expect(t.clean, where).toBe(true);
            continue;
          }
          expect(t.beat, where).toBe('steady');
          expect(matchBpm(t.bpm!, s.rpm, { tolerance: BPM_RELAXED }), where).toBeDefined();
          if (catalogRpm(t.bpm!) >= ROLE_SPRINT_RPM)
            expect(['hard', 'peak'], where).toContain(s.role);
          expect(t.clean, where).toBe(true); // explicit is off by default
        }
      }
    }
  });

  it('fits most sections without relaxing anything (spec §15: at least 90%)', () => {
    let open = 0;
    let plain = 0;
    for (const { p } of plans) {
      for (const s of p.sections) {
        if (s.locked) continue;
        open++;
        if (s.report.relaxed.every((r) => r === 'polish')) plain++;
      }
    }
    expect(plain / open).toBeGreaterThanOrEqual(0.9);
  });

  it('fills a section with songs that end within 45 s of its end in nearly every case', () => {
    let open = 0;
    let cut = 0;
    for (const { p } of plans) {
      for (const s of p.sections) {
        if (s.locked) continue;
        open++;
        if (s.report.warn.includes('cut')) cut++;
      }
    }
    expect(cut / open).toBeLessThan(0.02);
  });

  it('has no second without music in Neon Grid 45, Endurance 45 and Music climbs (spec §11.3)', () => {
    for (const id of ['class-neon-grid-45', 'class-endurance-45', 'music-climbs']) {
      const w = workout(id);
      expect(holes(w, plan(w), 1), id).toEqual([]);
    }
  });

  it('has no hole in any built-in workout (sampled every 10 s)', () => {
    for (const { w, p } of plans) expect(holes(w, p, 10), w.id).toEqual([]);
  });

  it('still fills every section with a single category chosen (stretching it when needed)', () => {
    const sample = ['class-neon-grid-45', 'music-climbs', 'zone2-60', 'class-hiit-30'];
    for (const c of MUSIC_CATEGORIES) {
      for (const id of sample) {
        const p = plan(workout(id), [c]);
        for (const s of p.sections) {
          if (s.locked) continue;
          expect(s.picks.length, `${c} ${id}/${s.sectionId}`).toBeGreaterThan(0);
          expect(s.report.warn, `${c} ${id}/${s.sectionId}`).not.toContain('gap');
        }
      }
    }
  });

  it('shuffles with another seed but keeps the same quality', () => {
    const w = workout('class-neon-grid-45');
    const ids = (seed: number) =>
      planSoundtrack(w, catalog, { ...DEFAULT_SOUNDTRACK_PREFS, seed })
        .sections.flatMap((s) => s.picks)
        .map((p) => p.ref.id);
    const one = ids(1);
    expect(ids(1)).toEqual(one);
    const others = [2, 3, 4].map(ids);
    expect(others.filter((o) => o.join() !== one.join()).length).toBeGreaterThan(0);
  });
});
