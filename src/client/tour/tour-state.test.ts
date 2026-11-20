import { describe, expect, it } from 'vitest';
import {
  createTourState,
  isLastStep,
  outcomeOnLeave,
  readTourOutcome,
  shouldAutoStart,
  tourReducer,
  writeTourOutcome,
} from './tour-state';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
  setItem: (): void => {
    throw new Error('blocked');
  },
};

describe('tourReducer', () => {
  it('starts at the first step and walks forward and back within bounds', () => {
    let s = createTourState(3);
    expect(s).toMatchObject({ running: false, index: 0, count: 3 });
    s = tourReducer(s, { type: 'start' });
    expect(s).toMatchObject({ running: true, index: 0 });
    s = tourReducer(s, { type: 'back' });
    expect(s.index).toBe(0);
    s = tourReducer(tourReducer(s, { type: 'next' }), { type: 'next' });
    expect(s.index).toBe(2);
    expect(isLastStep(s)).toBe(true);
  });

  it('ends after the last step and restarts from step 1', () => {
    let s = tourReducer(createTourState(2), { type: 'start' });
    s = tourReducer(tourReducer(s, { type: 'next' }), { type: 'next' });
    expect(s).toMatchObject({ running: false, index: 0 });
    expect(tourReducer(s, { type: 'start' })).toMatchObject({ running: true, index: 0 });
  });

  it('ignores next/back while the tour is not running, and stop resets', () => {
    const idle = createTourState(4);
    expect(tourReducer(idle, { type: 'next' })).toBe(idle);
    expect(tourReducer(idle, { type: 'back' })).toBe(idle);
    const mid = { running: true, index: 2, count: 4 };
    expect(tourReducer(mid, { type: 'stop' })).toMatchObject({ running: false, index: 0 });
  });

  it('never has fewer than one step', () => {
    expect(createTourState(0).count).toBe(1);
  });
});

describe('outcomeOnLeave', () => {
  it('is "done" only when moving on from the last step', () => {
    const last = { running: true, index: 2, count: 3 };
    const first = { running: true, index: 0, count: 3 };
    expect(outcomeOnLeave(last, 'next')).toBe('done');
    expect(outcomeOnLeave(last, 'stop')).toBe('skipped');
    expect(outcomeOnLeave(first, 'next')).toBe('skipped');
    expect(outcomeOnLeave(first, 'stop')).toBe('skipped');
  });
});

describe('stored outcome', () => {
  it('round-trips and turns off the automatic start', () => {
    const storage = memoryStorage();
    expect(shouldAutoStart('k', storage)).toBe(true);
    writeTourOutcome('k', 'done', storage, new Date('2026-11-19T10:00:00.000Z'));
    expect(JSON.parse(storage.data.get('k') ?? '{}')).toEqual({
      outcome: 'done',
      at: '2026-11-19T10:00:00.000Z',
    });
    expect(readTourOutcome('k', storage)).toBe('done');
    expect(shouldAutoStart('k', storage)).toBe(false);
  });

  it('treats a skipped tour as seen', () => {
    const storage = memoryStorage();
    writeTourOutcome('k', 'skipped', storage);
    expect(shouldAutoStart('k', storage)).toBe(false);
  });

  it('ignores garbage values and shows the tour again', () => {
    for (const raw of ['not json', '{}', '{"outcome":"weird"}', 'null', '']) {
      expect(readTourOutcome('k', memoryStorage({ k: raw }))).toBeUndefined();
    }
  });

  it('survives storage that throws or is missing', () => {
    expect(readTourOutcome('k', throwing)).toBeUndefined();
    expect(shouldAutoStart('k', throwing)).toBe(true);
    expect(() => writeTourOutcome('k', 'done', throwing)).not.toThrow();
    expect(readTourOutcome('k', undefined)).toBeUndefined();
  });
});
