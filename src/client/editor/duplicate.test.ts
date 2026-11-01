import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout } from '../../domain/workout';
import { builtinWorkouts } from '../data/builtin';
import { workoutSchema } from '../../domain/workout';
import { newWorkoutDraft } from './model';

const put = vi.hoisted(() => vi.fn());
vi.mock('../data/repositories', () => ({
  getRepositories: () => Promise.resolve({ workouts: { put } }),
}));

import { duplicateAndSave } from './duplicate';

beforeEach(() => put.mockReset());

describe('duplicateAndSave', () => {
  it('stores a user copy with fresh ids and a suffixed localized name', async () => {
    const src: Workout = {
      ...newWorkoutDraft('Base'),
      source: { kind: 'builtin' },
      localized: {
        pl: { name: 'Baza', description: 'opis' },
        en: { name: 'Base', description: 'd' },
      },
    };
    const copy = await duplicateAndSave(src, 'pl', ' (kopia)');
    expect(copy.name).toBe('Baza (kopia)');
    expect(copy.localized).toBeUndefined();
    expect(copy.source).toEqual({ kind: 'user' });
    expect(copy.id).not.toBe(src.id);
    expect(copy.blocks.map((b) => b.id)).not.toEqual(src.blocks.map((b) => b.id));
    expect(put).toHaveBeenCalledWith(copy);
  });

  it('produces a valid copy of every built-in workout (scaling ids remapped)', async () => {
    for (const w of builtinWorkouts) {
      const copy = await duplicateAndSave(w, 'en', ' (copy)');
      expect(workoutSchema.safeParse(copy).success, w.id).toBe(true);
    }
  });
});
