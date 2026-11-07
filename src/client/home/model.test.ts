import { describe, expect, it } from 'vitest';
import type { Segment } from '../../domain/segments';
import type { Workout } from '../../domain/workout';
import { chooseHero, gentleWorkout, ringZones, type PlanNext } from './model';

const NEXT: PlanNext = {
  planId: 'p',
  week: 2,
  weeks: 8,
  slot: 'progres',
  cycle: 1,
  workoutId: 'w1',
};

function wk(id: string, minutes: number, tags: string[] = [], category = 'freestyle'): Workout {
  return {
    id,
    category,
    tags,
    blocks: [{ type: 'steady', durationSec: minutes * 60, intensity: { effort: 3 } }],
  } as unknown as Workout;
}

function seg(startSec: number, durationSec: number, effort: number): Segment {
  return { startSec, durationSec, effortStart: effort, effortEnd: effort } as Segment;
}

describe('gentleWorkout', () => {
  it('prefers endurance, then the length closest to 30 minutes', () => {
    const list = [wk('a', 30), wk('b', 60, ['endurance']), wk('c', 35, ['endurance'])];
    expect(gentleWorkout(list)?.id).toBe('c');
  });
  it('is undefined for an empty library', () => {
    expect(gentleWorkout([])).toBeUndefined();
  });
});

describe('chooseHero', () => {
  const workouts = [wk('easy', 30, ['endurance']), wk('w1', 45), wk('hard', 20, ['hiit'])];
  it('shows the next plan session on the plan tile', () => {
    expect(chooseHero({ tab: 'plan', next: NEXT, workouts })).toEqual({ kind: 'plan', next: NEXT });
  });
  it('falls back to the plan hero for Experience', () => {
    expect(chooseHero({ tab: 'experience', next: NEXT, workouts }).kind).toBe('plan');
  });
  it('offers a gentle starter workout without a plan', () => {
    expect(chooseHero({ tab: 'plan', next: null, workouts })).toEqual({
      kind: 'starter',
      workoutId: 'easy',
    });
  });
  it('shows the last workout on the freestyle tile', () => {
    expect(chooseHero({ tab: 'free', next: null, lastWorkoutId: 'hard', workouts })).toEqual({
      kind: 'free',
      workoutId: 'hard',
      source: 'last',
    });
  });
  it('recommends a workout when the last one is unknown or gone', () => {
    expect(chooseHero({ tab: 'free', next: null, lastWorkoutId: 'gone', workouts })).toEqual({
      kind: 'free',
      workoutId: 'easy',
      source: 'recommended',
    });
  });
});

describe('ringZones', () => {
  it('returns one clamped zone per ring in workout order', () => {
    const zones = ringZones([seg(0, 100, 2), seg(100, 100, 9)], 4);
    expect(zones).toEqual([2, 2, 9, 9]);
  });
  it('averages mixed slices', () => {
    expect(ringZones([seg(0, 50, 2), seg(50, 50, 8)], 1)).toEqual([5]);
  });
  it('is empty without segments', () => {
    expect(ringZones([], 10)).toEqual([]);
  });
});
