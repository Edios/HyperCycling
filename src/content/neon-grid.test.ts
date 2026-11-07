import { describe, expect, it } from 'vitest';
import { builtinExperiences, getWorkout } from '../client/data/builtin';
import { sceneChangeAllowed } from '../client/world/worlds/scenes-schedule';
import { THEMES } from '../client/world/worlds/scenes-themes';
import { experienceProblems, resolveChapters, songStartsSec } from '../domain/experience';
import { flattenWorkout } from '../domain/segments';
import { totalDurationSec } from '../domain/workout';

const exp = builtinExperiences.find((e) => e.id === 'neon-grid-45');
const workout = getWorkout('class-neon-grid-45');

/** The five resistance steps of the scenario (S1..S5) as effort levels. */
const STEP_EFFORTS = [3, 4, 6, 7, 9];

describe('Neon Grid 45 scenario', () => {
  it('is loaded with its workout and has no problems', () => {
    expect(exp).toBeDefined();
    expect(workout).toBeDefined();
    expect(experienceProblems(exp!, workout!)).toEqual([]);
    expect(exp!.stepCount).toBe(5);
  });

  it('is 45 minutes in 11 songs with the warm-up and cool-down of the design', () => {
    expect(totalDurationSec(workout!)).toBe(45 * 60);
    expect(workout!.songs).toHaveLength(11);
    const starts = songStartsSec(workout!);
    expect(starts.map((s) => s / 60)).toEqual([0, 5, 9, 13.5, 16, 22, 24.5, 29.5, 32, 37, 41]);
    const segs = flattenWorkout(workout!);
    expect(segs[0]?.label).toBe('@warmup');
    expect(totalDurationSec(workout!) - (starts[10] ?? 0)).toBe(4 * 60);
  });

  it('keeps the chapters of the design on the song boundaries', () => {
    const chapters = resolveChapters(exp!, workout!);
    expect(chapters.map((c) => c.startSec / 60)).toEqual([0, 9, 16, 24.5, 32, 37, 41]);
    expect(chapters.map((c) => c.look)).toEqual([
      'grid-wake',
      'light-lanes',
      'arches',
      'surge',
      'summit-scan',
      'overdrive',
      'afterglow',
    ]);
    const starts = new Set(songStartsSec(workout!));
    for (const c of chapters) expect(starts.has(c.startSec), String(c.startSec)).toBe(true);
  });

  it('never changes the scene into a sprint or effort 9+, so every chapter shows', () => {
    const segs = flattenWorkout(workout!);
    for (const c of resolveChapters(exp!, workout!)) {
      expect(sceneChangeAllowed(segs, c.startSec), `chapter at ${c.startSec}s`).toBe(true);
    }
  });

  it('defines every look the chapters ask for', () => {
    const theme = THEMES[exp!.worldTheme.theme];
    expect(theme).toBeDefined();
    for (const c of exp!.worldTheme.chapters ?? []) {
      expect(Object.keys(theme!.looks)).toContain(c.look);
    }
  });

  it('uses exactly the five resistance steps and only small, announced changes', () => {
    const segs = flattenWorkout(workout!);
    for (const s of segs) expect(STEP_EFFORTS, s.blockId).toContain(s.effortStart);
    const rank = (e: number): number => STEP_EFFORTS.indexOf(e);
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1]!;
      const cur = segs[i]!;
      const jump = rank(cur.effortStart) - rank(prev.effortEnd);
      expect(Math.abs(jump), `${prev.blockId} to ${cur.blockId}`).toBeLessThanOrEqual(2);
      // every resistance change is announced by a cue (repeat reps after the first stay silent)
      if (jump !== 0 && cur.rep === 1) expect(cur.cue, cur.blockId).toBeDefined();
    }
  });

  it('keeps a resistance step for at least 20 s', () => {
    const segs = flattenWorkout(workout!);
    let run = 0;
    let effort = -1;
    for (const s of segs) {
      if (s.effortStart === effort) run += s.durationSec;
      else {
        if (effort !== -1) expect(run).toBeGreaterThanOrEqual(20);
        effort = s.effortStart;
        run = s.durationSec;
      }
    }
  });

  it('limits standing: blocks up to 60 s, 30 s on the top step, at most 7 minutes', () => {
    let standing = 0;
    for (const s of flattenWorkout(workout!)) {
      if (s.position !== 'standing') continue;
      standing += s.durationSec;
      expect(s.durationSec, s.blockId).toBeLessThanOrEqual(60);
      if (s.effortStart >= 9) expect(s.durationSec, s.blockId).toBeLessThanOrEqual(30);
      expect(s.rpm ?? 0, s.blockId).toBeLessThanOrEqual(75);
    }
    expect(standing).toBeLessThanOrEqual(7 * 60);
  });

  it('keeps the top step short and sprints at 15 s', () => {
    const segs = flattenWorkout(workout!);
    const hardSec = segs.filter((s) => s.effortStart >= 9).reduce((a, s) => a + s.durationSec, 0);
    expect(hardSec).toBeLessThanOrEqual(90);
    for (const s of segs.filter((x) => (x.rpm ?? 0) >= 105)) {
      expect(s.durationSec, s.blockId).toBeLessThanOrEqual(15);
    }
  });
});
