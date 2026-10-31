import { afterEach, describe, expect, it } from 'vitest';
import type { Workout } from '../../domain/workout';
import { clearStoredResult, loadStoredResult, useLastResult, type LastResult } from './last-result';

const workout = {
  id: 'w1',
  name: 'Test',
  blocks: [{ kind: 'steady', id: 'a', durationSec: 10, intensity: { effort: 3 } }],
} as unknown as Workout;

const result: LastResult = {
  workout,
  riddenSec: 600,
  completed: true,
  config: { background: 'basic', hud: 'solo', playerIds: [], music: false },
  players: [],
  startedAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  useLastResult.getState().clear();
  sessionStorage.clear();
});

describe('last result persistence', () => {
  it('set keeps the result in session storage and clear removes it', () => {
    useLastResult.getState().set(result);
    expect(loadStoredResult()).toMatchObject({ riddenSec: 600, restored: true });
    useLastResult.getState().clear();
    expect(loadStoredResult()).toBeUndefined();
  });

  it('ignores garbage in storage', () => {
    sessionStorage.setItem('spinning-tutor.lastResult', '{"nope":1}');
    expect(loadStoredResult()).toBeUndefined();
    sessionStorage.setItem('spinning-tutor.lastResult', 'not json');
    expect(loadStoredResult()).toBeUndefined();
  });

  it('a stored result can be dropped directly', () => {
    useLastResult.getState().set(result);
    clearStoredResult();
    expect(loadStoredResult()).toBeUndefined();
  });
});
