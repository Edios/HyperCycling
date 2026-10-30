import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenWorkout } from '../../domain/segments';
import type { Workout } from '../../domain/workout';
import {
  configureSessionSideEffects,
  resetSessionClock,
  setSessionClock,
  useSessionStore,
} from './session-store';
import { useSessionLoop } from './useSessionLoop';

function Host() {
  useSessionLoop();
  return null;
}

const workout = {
  id: 'w',
  name: 'W',
  blocks: [{ kind: 'steady', id: 'a', durationSec: 10, intensity: { effort: 3 } }],
} as unknown as Workout;

describe('useSessionLoop', () => {
  let frames: FrameRequestCallback[];
  let cancelled: number[];

  beforeEach(() => {
    frames = [];
    cancelled = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => cancelled.push(id));
    setSessionClock(() => 0);
    configureSessionSideEffects({
      wakeLock: { acquire: async () => undefined, release: async () => undefined },
      save: async () => undefined,
      clear: async () => undefined,
    });
  });

  afterEach(() => {
    useSessionStore.getState().stop();
    resetSessionClock();
    configureSessionSideEffects(null);
    vi.unstubAllGlobals();
  });

  it('does not schedule frames without a runtime', () => {
    render(<Host />);
    expect(frames).toHaveLength(0);
  });

  it('ticks once per frame while loaded and cancels on unmount', () => {
    const tick = vi.spyOn(useSessionStore.getState(), 'tick');
    useSessionStore.getState().load({
      workout,
      segments: flattenWorkout(workout),
      config: { background: 'basic', hud: 'solo', playerIds: [], music: false },
      players: [],
    });
    const { unmount } = render(<Host />);
    expect(frames).toHaveLength(1);
    frames[0]?.(0);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(2);
    unmount();
    expect(cancelled).toEqual([2]);
  });
});
