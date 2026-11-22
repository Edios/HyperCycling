import { describe, expect, it } from 'vitest';
import { FIRST_VISIT_PREFS } from '../../domain/soundtrack-wizard';
import { loadSoundtrackPrefs, saveSoundtrackPrefs, SOUNDTRACK_PREFS_KEY } from './prefs';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('soundtrack prefs storage', () => {
  it('starts a first visit on the first-visit choice', () => {
    expect(loadSoundtrackPrefs(memory())).toEqual(FIRST_VISIT_PREFS);
  });

  it('keeps the last choice under the hypercycling key', () => {
    const store = memory();
    const prefs = {
      ...FIRST_VISIT_PREFS,
      categories: ['rock' as const],
      continuity: 'gapsOk' as const,
      seed: 77,
    };
    expect(saveSoundtrackPrefs(prefs, store)).toBe(true);
    expect(store.data.has(SOUNDTRACK_PREFS_KEY)).toBe(true);
    expect(SOUNDTRACK_PREFS_KEY).toBe('hypercycling.soundtrack.prefs');
    expect(loadSoundtrackPrefs(store)).toEqual(prefs);
  });

  it('reads a damaged entry as the first-visit choice and a partly good one field by field', () => {
    expect(loadSoundtrackPrefs(memory({ [SOUNDTRACK_PREFS_KEY]: '{oops' }))).toEqual(
      FIRST_VISIT_PREFS,
    );
    const half = loadSoundtrackPrefs(
      memory({ [SOUNDTRACK_PREFS_KEY]: JSON.stringify({ categories: ['lofi'], explicit: 3 }) }),
    );
    expect(half.categories).toEqual(['lofi']);
    expect(half.explicit).toBe(false);
  });

  it('survives storage that refuses to work', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    };
    expect(loadSoundtrackPrefs(blocked)).toEqual(FIRST_VISIT_PREFS);
    expect(saveSoundtrackPrefs(FIRST_VISIT_PREFS, blocked)).toBe(false);
    expect(saveSoundtrackPrefs(FIRST_VISIT_PREFS, undefined)).toBe(
      typeof localStorage !== 'undefined',
    );
  });
});
