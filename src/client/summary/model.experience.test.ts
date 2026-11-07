import { describe, expect, it } from 'vitest';
import { builtinExperiences, getWorkout } from '../data/builtin';
import type { LastResult } from '../training/last-result';
import { reachedChapters, setupPath } from './model';

const exp = builtinExperiences.find((e) => e.id === 'neon-grid-45')!;
const workout = getWorkout('class-neon-grid-45')!;

describe('Experience summary', () => {
  it('counts the chapters the rider got into', () => {
    expect(reachedChapters(exp, workout, 0).looks).toEqual([]);
    expect(reachedChapters(exp, workout, 60).looks).toEqual(['grid-wake']);
    expect(reachedChapters(exp, workout, 9 * 60).looks).toEqual(['grid-wake']);
    expect(reachedChapters(exp, workout, 9 * 60 + 1).looks).toEqual(['grid-wake', 'light-lanes']);
    const all = reachedChapters(exp, workout, 45 * 60);
    expect(all.looks).toHaveLength(7);
    expect(all.total).toBe(7);
  });

  it('rides the same Experience again', () => {
    const base = { workout, riddenSec: 10, completed: true } as unknown as LastResult;
    expect(setupPath({ ...base, experienceId: 'neon-grid-45' })).toBe(
      '/setup/class-neon-grid-45?exp=neon-grid-45',
    );
    expect(setupPath(base)).toBe('/setup/class-neon-grid-45');
  });
});
