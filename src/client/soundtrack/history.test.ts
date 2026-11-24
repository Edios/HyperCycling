import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUNDTRACK_PREFS, type SoundtrackPlan } from '../../domain/soundtrack-plan';
import {
  freshSeed,
  HISTORY_RIDES,
  historyIds,
  loadSoundtrackHistory,
  recordSoundtrackRide,
  SOUNDTRACK_HISTORY_KEY,
} from './history';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** A plan with one song per id, all in one section (only what the history reads matters). */
function plan(workoutId: string, ids: string[]): SoundtrackPlan {
  return {
    v: 1,
    workoutId,
    fingerprint: '00000000',
    prefs: DEFAULT_SOUNDTRACK_PREFS,
    sections: [
      {
        sectionId: 's1',
        anchor: { blockId: 'a', rep: 1 },
        startSec: 0,
        durationSec: 600,
        role: 'steady',
        rpm: 90,
        picks: ids.map((id, i) => ({
          ref: { kind: 'catalog', id },
          upload: 'aaaaaaaaaaa',
          startAtSec: 0,
          atSec: i * 200,
          playSec: 200,
          fit: 'on-beat',
        })),
        report: { gapSec: 0, cutSec: 0, relaxed: [], warn: [], fills: [] },
      },
    ],
    fallback: [],
  };
}

describe('soundtrack history (rotation between rides)', () => {
  it('is empty at first and keeps a confirmed plan under the hypercycling key', () => {
    const store = memory();
    expect(loadSoundtrackHistory(store)).toEqual([]);
    expect(SOUNDTRACK_HISTORY_KEY).toBe('hypercycling.soundtrack.history');
    expect(
      recordSoundtrackRide(plan('w1', ['a', 'b']), new Date('2026-11-24T10:00:00Z'), store),
    ).toBe(true);
    expect(loadSoundtrackHistory(store)).toEqual([
      { at: '2026-11-24T10:00:00.000Z', workoutId: 'w1', ids: ['a', 'b'] },
    ]);
  });

  it('puts the newest ride first, replaces the same workout and keeps the last 8', () => {
    const store = memory();
    for (let i = 0; i < 10; i++) recordSoundtrackRide(plan(`w${i}`, [`s${i}`]), new Date(), store);
    recordSoundtrackRide(plan('w9', ['again']), new Date(), store);
    const rides = loadSoundtrackHistory(store);
    expect(rides).toHaveLength(HISTORY_RIDES);
    expect(historyIds(rides)[0]).toEqual(['again']);
    expect(rides.filter((r) => r.workoutId === 'w9')).toHaveLength(1);
    expect(rides.map((r) => r.workoutId)).not.toContain('w0');
  });

  it('reads damaged or foreign entries as empty, and survives a storage that refuses', () => {
    expect(loadSoundtrackHistory(memory({ [SOUNDTRACK_HISTORY_KEY]: '{oops' }))).toEqual([]);
    expect(
      loadSoundtrackHistory(memory({ [SOUNDTRACK_HISTORY_KEY]: '{"v":2,"rides":[]}' })),
    ).toEqual([]);
    const mixed = JSON.stringify({
      v: 1,
      rides: [{ at: 'x', workoutId: 'w', ids: ['a', 3, ''] }, { nope: true }, 'bad'],
    });
    expect(loadSoundtrackHistory(memory({ [SOUNDTRACK_HISTORY_KEY]: mixed }))).toEqual([
      { at: 'x', workoutId: 'w', ids: ['a'] },
    ]);
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(recordSoundtrackRide(plan('w', ['a']), new Date(), refusing)).toBe(false);
  });

  it('draws a new seed from the clock, within the range the prefs accept', () => {
    expect(freshSeed(1_700_000_000_123)).not.toBe(freshSeed(1_700_000_000_124));
    for (const ms of [0, 1_700_000_000_123, 2 ** 40 + 5]) {
      const s = freshSeed(ms);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 31);
    }
  });
});
