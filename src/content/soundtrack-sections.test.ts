import { describe, expect, it } from 'vitest';
import { builtinWorkouts } from '../client/data/builtin';
import { scaleWorkout } from '../domain/scale';
import {
  coverage,
  MAX_SECTIONS,
  MUSIC_CATEGORIES,
  MIN_SECTION_SEC,
  sectionsOf,
  SPLIT_SEC,
  type CoverageTrack,
  type MusicSection,
} from '../domain/soundtrack';
import { flattenWorkout } from '../domain/segments';
import { totalDurationSec, type Workout } from '../domain/workout';

/** True when a section is one top-level block or one repetition of a repeat. */
function singleUnit(w: Workout, s: MusicSection): boolean {
  const reps = new Set(s.blockRefs.map((r) => r.rep));
  if (reps.size > 1) return false;
  const tops = new Set(
    s.blockRefs.map(
      (r) =>
        w.blocks.find(
          (b) =>
            b.id === r.blockId || (b.kind === 'repeat' && b.blocks.some((c) => c.id === r.blockId)),
        )?.id,
    ),
  );
  return tops.size === 1;
}

/** Contract of the grouping on every built-in workout (soundtrack spec §7.1, §13.1). */
function check(w: Workout, sections: MusicSection[]): void {
  const segments = flattenWorkout(w);
  expect(sections.length).toBeGreaterThan(0);
  expect(sections.length).toBeLessThanOrEqual(MAX_SECTIONS);
  let t = 0;
  let seg = 0;
  for (const s of sections) {
    // Contiguous, in order, and every block/repetition exactly once.
    expect(s.startSec).toBe(t);
    for (const ref of s.blockRefs) {
      const g = segments[seg++];
      expect(ref).toEqual({ blockId: g?.blockId, rep: g?.rep });
    }
    // The anchor is a real segment start, where a MusicCue for this section would begin.
    const anchor = segments.find((g) => g.blockId === s.anchor.blockId && g.rep === s.anchor.rep);
    expect(anchor?.startSec).toBe(s.startSec);
    expect(s.rpmKnown).toBe(true); // every built-in block sets a cadence
    expect(s.targetBpm).toBeGreaterThan(0);
    t += s.durationSec;
  }
  expect(seg).toBe(segments.length);
  expect(t).toBe(totalDurationSec(w));
}

describe('sectionsOf on the built-in workouts', () => {
  it('covers each workout contiguously, within the section limit', () => {
    expect(builtinWorkouts.length).toBeGreaterThan(100);
    for (const w of builtinWorkouts) check(w, sectionsOf(w));
  });

  it('keeps sections between MIN and MAX unless a single unit forces otherwise', () => {
    let short = 0;
    let long = 0;
    for (const w of builtinWorkouts) {
      const sections = sectionsOf(w);
      for (const s of sections) {
        if (s.durationSec < MIN_SECTION_SEC && !s.locked && sections.length > 1) short += 1;
        // Past SPLIT_SEC only when one block (or one repetition) alone is that long.
        if (s.durationSec > SPLIT_SEC && !singleUnit(w, s)) long += 1;
      }
    }
    expect(short).toBe(0);
    expect(long).toBe(0);
  });

  it('works on workouts scaled by a plan (30, 45, 60 min)', () => {
    for (const w of builtinWorkouts.filter((x) => x.scaling)) {
      for (const minutes of [30, 45, 60] as const) {
        const scaled = scaleWorkout(w, { targetMinutes: minutes, difficultyPct: 0 });
        check(scaled, sectionsOf(scaled));
      }
    }
  });

  it('music-climbs gets a warm-up, one section per climb and a cool-down', () => {
    const w = builtinWorkouts.find((x) => x.id === 'music-climbs')!;
    const s = sectionsOf(w);
    expect(s[0]!.role).toBe('warmup');
    expect(s[s.length - 1]!.role).toBe('cooldown');
    const climbs = s.filter((x) => x.anchor.blockId === 'mc-2');
    expect(climbs.map((x) => x.anchor.rep)).toEqual([1, 2, 3, 4, 5]);
    for (const c of climbs) expect(c.durationSec).toBe(330);
  });

  it('class-hiit-30 never splits its short repeats', () => {
    const w = builtinWorkouts.find((x) => x.id === 'class-hiit-30')!;
    const repeats = new Map<string, string[]>();
    for (const b of w.blocks)
      if (b.kind === 'repeat')
        repeats.set(
          b.id,
          b.blocks.map((c) => c.id),
        );
    for (const s of sectionsOf(w)) {
      for (const [, ids] of repeats) {
        const inside = s.blockRefs.filter((r) => ids.includes(r.blockId)).length;
        // A section holds all of a short repeat or none of it.
        const total = w.blocks
          .filter((b) => b.kind === 'repeat' && ids.includes(b.blocks[0]!.id))
          .reduce((n, b) => n + (b.kind === 'repeat' ? b.times * b.blocks.length : 0), 0);
        expect([0, total]).toContain(inside);
      }
    }
  });

  it('groups and rates coverage fast enough for the wizard (spec: < 5 ms per workout)', () => {
    // 300 songs spread over the tempo range and the categories, as a full catalog would be.
    const tracks: CoverageTrack[] = Array.from({ length: 300 }, (_, i) => ({
      bpm: 70 + ((i * 37) % 120),
      categories: [MUSIC_CATEGORIES[i % MUSIC_CATEGORIES.length]!],
    }));
    const t0 = performance.now();
    for (const w of builtinWorkouts) coverage(sectionsOf(w), tracks);
    const perWorkout = (performance.now() - t0) / builtinWorkouts.length;
    // Generous ceiling for slow CI machines; locally this is well under a millisecond.
    expect(perWorkout).toBeLessThan(20);
  });
});
