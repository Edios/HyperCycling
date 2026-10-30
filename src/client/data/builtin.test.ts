import { describe, expect, it } from 'vitest';
import { planSchema } from '../../domain/plan';
import { workoutSchema } from '../../domain/workout';
import { builtinPlans, builtinWorkouts, getWorkout } from './builtin';

describe('built-in content', () => {
  it('ships at least one workout', () => {
    expect(builtinWorkouts.length).toBeGreaterThan(0);
  });

  it('every workout passes workoutSchema and is marked builtin', () => {
    for (const w of builtinWorkouts) {
      const r = workoutSchema.safeParse(w);
      expect(r.success, `${w.id}: ${r.success ? '' : r.error.message}`).toBe(true);
      expect(w.source.kind).toBe('builtin');
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
});
