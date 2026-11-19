import { describe, expect, it } from 'vitest';
import { builtinExperiences, builtinWorkouts } from '../data/builtin';
import { effortRange } from './model';

describe('effortRange', () => {
  it('matches the range the Neon Grid descriptions promise', () => {
    const neon = builtinExperiences.filter((e) => e.id.startsWith('neon-grid'));
    expect(neon.length).toBeGreaterThan(0);
    for (const e of neon) {
      const workout = builtinWorkouts.find((w) => w.id === e.workoutRef.id);
      const range = effortRange(workout!);
      expect(range).toBeDefined();
      expect(workout?.description).toContain(`effort ${range?.min}–${range?.max}:`);
    }
  });
});
