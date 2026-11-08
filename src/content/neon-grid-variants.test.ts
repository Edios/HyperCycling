import { describe, expect, it } from 'vitest';
import { builtinExperiences, getWorkout } from '../client/data/builtin';
import { sceneChangeAllowed } from '../client/world/worlds/scenes-schedule';
import { THEMES } from '../client/world/worlds/scenes-themes';
import { doseWarnings } from '../domain/dose-rules';
import { experienceProblems, resolveChapters, songStartsSec } from '../domain/experience';
import { flattenWorkout } from '../domain/segments';
import { totalDurationSec } from '../domain/workout';

const STEP_EFFORTS = [3, 4, 6, 7, 9];
const VARIANTS = [
  { id: 'neon-grid-30', workout: 'class-neon-grid-30', minutes: 30, songs: 7 },
  { id: 'neon-grid-45-light', workout: 'class-neon-grid-45-light', minutes: 45, songs: 11 },
] as const;

describe.each(VARIANTS)('Neon Grid variant $id', (v) => {
  const exp = builtinExperiences.find((e) => e.id === v.id);
  const workout = getWorkout(v.workout);

  it('loads with no problems and the right length and song count', () => {
    expect(exp && workout).toBeTruthy();
    expect(experienceProblems(exp!, workout!)).toEqual([]);
    expect(totalDurationSec(workout!)).toBe(v.minutes * 60);
    expect(workout!.songs).toHaveLength(v.songs);
    expect(exp!.lengthMin).toBe(v.minutes);
    expect(workout!.silenceLastSec).toBe(60);
  });

  it('opens with a 30 s welcome inside a 5 min warm-up and ends with a 4 min cool-down', () => {
    const segs = flattenWorkout(workout!);
    expect(segs[0]?.durationSec).toBe(30);
    expect(segs[0]?.cue).toBe('@ngWelcome');
    const starts = songStartsSec(workout!);
    expect(starts[1]).toBe(5 * 60);
    expect(totalDurationSec(workout!) - (starts.at(-1) ?? 0)).toBe(4 * 60);
  });

  it('puts chapters on song boundaries, never into a sprint, with defined looks', () => {
    const chapters = resolveChapters(exp!, workout!);
    const starts = new Set(songStartsSec(workout!));
    const segs = flattenWorkout(workout!);
    const theme = THEMES[exp!.worldTheme.theme]!;
    for (const c of chapters) {
      expect(starts.has(c.startSec), String(c.startSec)).toBe(true);
      expect(sceneChangeAllowed(segs, c.startSec), `chapter at ${c.startSec}s`).toBe(true);
      expect(Object.keys(theme.looks)).toContain(c.look);
    }
    expect(chapters[0]?.look).toBe('grid-wake');
    expect(chapters.at(-1)?.look).toBe('afterglow');
  });

  it('uses only the five steps, announces every change and has no dosing warning', () => {
    const segs = flattenWorkout(workout!);
    for (const s of segs) expect(STEP_EFFORTS, s.blockId).toContain(s.effortStart);
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1]!;
      const cur = segs[i]!;
      const jump = STEP_EFFORTS.indexOf(cur.effortStart) - STEP_EFFORTS.indexOf(prev.effortEnd);
      expect(Math.abs(jump), cur.blockId).toBeLessThanOrEqual(2);
      if (jump !== 0 && cur.rep === 1) expect(cur.cue, cur.blockId).toBeDefined();
    }
    expect(doseWarnings(workout!).filter((x) => x.level === 'warn')).toEqual([]);
  });

  it('gives every rest song at least 3:00', () => {
    const w = workout!;
    const starts = songStartsSec(w);
    (w.songs ?? []).forEach((s, i) => {
      if (!/^ng[48]r-a$/.test(s.firstBlockId) && !/^ng6r-a$/.test(s.firstBlockId)) return;
      const end = starts[i + 1] ?? totalDurationSec(w);
      expect(end - (starts[i] ?? 0), s.id).toBeGreaterThanOrEqual(3 * 60);
    });
  });
});

describe('Neon Grid variants differ as designed', () => {
  const ids = (id: string): string[] => getWorkout(id)!.blocks.map((b) => b.id);

  it('the 30 has no rolling hills or pyramid; the light has no summit block', () => {
    const w30 = ids('class-neon-grid-30');
    expect(w30.some((b) => b.startsWith('ng5-') || b.startsWith('ng7-'))).toBe(false);
    expect(w30.some((b) => b.startsWith('ng9-'))).toBe(true);
    const light = flattenWorkout(getWorkout('class-neon-grid-45-light')!);
    expect(light.some((s) => s.effortStart >= 9)).toBe(false);
    expect(ids('class-neon-grid-45-light').some((b) => b.startsWith('ng9-'))).toBe(false);
  });

  it('the 30 rests at least 3:00 after the summit before the sprints', () => {
    const segs = flattenWorkout(getWorkout('class-neon-grid-30')!);
    const summitEnd = segs.reduce((m, s) => (s.effortStart >= 9 ? s.startSec + s.durationSec : m), 0);
    const sprintStart = segs.find((s) => s.blockId === 'ng10-s1')!.startSec;
    expect(sprintStart - summitEnd).toBeGreaterThanOrEqual(3 * 60);
  });
});
