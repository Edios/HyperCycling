import { describe, expect, it } from 'vitest';
import { planSchema } from '../../domain/plan';
import { builtinPlans, builtinWorkouts, getExperience, getWorkout } from './builtin';

describe('built-in content', () => {
  it('ships at least one workout', () => {
    expect(builtinWorkouts.length).toBeGreaterThan(0);
  });

  it('workout ids match their file names and are marked builtin', () => {
    const files = import.meta.glob<{ id: string }>('../../content/workouts/*.json', {
      eager: true,
      import: 'default',
    });
    expect(Object.keys(files).length).toBe(builtinWorkouts.length);
    for (const [path, w] of Object.entries(files)) {
      const base = path.split('/').pop()?.replace(/\.json$/, '');
      expect(w.id, path).toBe(base);
      expect(w.id, path).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(getWorkout(w.id)?.source.kind, path).toBe('builtin');
    }
  });

  it('every plan passes planSchema', () => {
    for (const p of builtinPlans) {
      const r = planSchema.safeParse(p);
      expect(r.success, `${p.id}: ${r.success ? '' : r.error.message}`).toBe(true);
    }
  });

  it('every plan references existing workout ids', () => {
    const ids = new Set(builtinWorkouts.map((w) => w.id));
    for (const p of builtinPlans) {
      for (const week of p.weeks) {
        for (const s of week.sessions) expect(ids.has(s.workoutId), `${p.id} -> ${s.workoutId}`).toBe(true);
        if (week.progresAlt) expect(ids.has(week.progresAlt), `${p.id} -> ${week.progresAlt}`).toBe(true);
      }
    }
  });

  it('ids are unique', () => {
    const w = builtinWorkouts.map((x) => x.id);
    const p = builtinPlans.map((x) => x.id);
    expect(new Set(w).size).toBe(w.length);
    expect(new Set(p).size).toBe(p.length);
  });

  it('getWorkout finds built-in workouts by id', () => {
    const first = builtinWorkouts[0];
    expect(first && getWorkout(first.id)).toBe(first);
    expect(getWorkout('does-not-exist')).toBeUndefined();
  });

  it('only an experience that asks for choreography gets the cue sheets (Neon Grid 30)', () => {
    expect(getExperience('neon-grid-30')?.cueSheets?.length).toBeGreaterThan(0);
    // Neon Grid 45 plays some of the same songs, but its blocks are not anchored to them.
    expect(getExperience('neon-grid-45')?.cueSheets).toBeUndefined();
    expect(getExperience('neon-grid-45-light')?.cueSheets).toBeUndefined();
  });
});
