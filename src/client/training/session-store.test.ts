import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenWorkout } from '../../domain/segments';
import type { Workout } from '../../domain/workout';
import type { ActiveSession } from '../../domain/session-log';
import type { SessionConfig } from '../../domain/settings';
import {
  configureSessionSideEffects,
  resetSessionClock,
  setSessionClock,
  subscribeSessionEvents,
  useSessionStore,
  createAutosave,
  type SessionRuntime,
  type SessionStore,
} from './session-store';

const config: SessionConfig = { background: 'basic', hud: 'solo', playerIds: [], music: false };

function makeWorkout(): Workout {
  return {
    id: 'w1',
    name: 'Test',
    blocks: [
      { kind: 'steady', id: 'a', durationSec: 10, intensity: { effort: 3 } },
      { kind: 'steady', id: 'b', durationSec: 10, intensity: { effort: 6 } },
    ],
  } as unknown as Workout;
}

function makeRuntime(plan?: SessionRuntime['plan']): SessionRuntime {
  const workout = makeWorkout();
  const rt: SessionRuntime = { workout, segments: flattenWorkout(workout), config, players: [] };
  if (plan) rt.plan = plan;
  return rt;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let now = 0;
const saved: ActiveSession[] = [];
const wl = { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
let cleared = 0;

beforeEach(() => {
  now = 0;
  saved.length = 0;
  cleared = 0;
  wl.acquire.mockClear();
  wl.release.mockClear();
  setSessionClock(() => now);
  configureSessionSideEffects({
    wakeLock: wl,
    save: async (a) => {
      saved.push(a);
    },
    clear: async () => {
      cleared++;
    },
  });
  useSessionStore.getState().stop();
  wl.release.mockClear();
  cleared = 0;
});

afterEach(() => {
  useSessionStore.getState().stop();
  resetSessionClock();
  configureSessionSideEffects(null);
});

describe('session store', () => {
  it('starts idle without runtime', () => {
    const s = useSessionStore.getState();
    expect(s.runtime).toBeUndefined();
    expect(s.state.status).toBe('idle');
    expect(s.muted).toBe(false);
  });

  it('load -> start -> countdown -> running -> pause -> resume', () => {
    const s = useSessionStore.getState();
    s.load(makeRuntime());
    expect(useSessionStore.getState().state.status).toBe('idle');
    s.start();
    expect(useSessionStore.getState().state.status).toBe('countdown');
    expect(useSessionStore.getState().state.startCountdown).toBe(3);
    now = 3000;
    s.tick();
    now = 5000;
    s.tick();
    expect(useSessionStore.getState().state.status).toBe('running');
    expect(useSessionStore.getState().state.workoutElapsedSec).toBeCloseTo(2);
    s.pause();
    expect(useSessionStore.getState().state.status).toBe('paused');
    now = 9000;
    expect(useSessionStore.getState().state.workoutElapsedSec).toBeCloseTo(2);
    s.resume();
    now = 10000;
    s.tick();
    expect(useSessionStore.getState().state.workoutElapsedSec).toBeCloseTo(3);
  });

  it('next and prev move between segments', () => {
    const s = useSessionStore.getState();
    s.load(makeRuntime());
    s.start();
    now = 3000;
    s.tick();
    s.next();
    expect(useSessionStore.getState().state.segmentIndex).toBe(1);
    s.prev();
    expect(useSessionStore.getState().state.segmentIndex).toBe(0);
  });

  it('load with a snapshot restores paused', () => {
    useSessionStore
      .getState()
      .load(makeRuntime(), { segmentIndex: 1, workoutElapsedSec: 12, status: 'running' });
    const st = useSessionStore.getState().state;
    expect(st.status).toBe('paused');
    expect(st.segmentIndex).toBe(1);
    expect(st.workoutElapsedSec).toBeCloseTo(12);
  });

  it('toggleMute flips muted', () => {
    const s = useSessionStore.getState();
    s.toggleMute();
    expect(useSessionStore.getState().muted).toBe(true);
    s.toggleMute();
    expect(useSessionStore.getState().muted).toBe(false);
  });

  it('stop unloads the runtime, clears the active session and releases the wake lock', async () => {
    const s = useSessionStore.getState();
    s.load(makeRuntime());
    s.start();
    const before = cleared;
    s.stop();
    expect(useSessionStore.getState().runtime).toBeUndefined();
    expect(useSessionStore.getState().state.status).toBe('idle');
    await flush();
    expect(cleared).toBe(before + 1);
    expect(wl.release).toHaveBeenCalled();
  });

  it('tick publishes each engine event exactly once and finish clears + releases', async () => {
    const s = useSessionStore.getState();
    const seen: string[] = [];
    const unsub = subscribeSessionEvents((e) => seen.push(e.type));
    s.load(makeRuntime());
    s.start();
    now = 3000;
    s.tick();
    now = 13000; // into segment 2
    const ev = s.tick();
    expect(ev.map((e) => e.type)).toContain('segmentChanged');
    expect(seen.filter((t) => t === 'segmentChanged')).toHaveLength(1);
    const clearedBefore = cleared;
    now = 24000;
    s.tick();
    expect(useSessionStore.getState().state.status).toBe('finished');
    expect(seen.filter((t) => t === 'finished')).toHaveLength(1);
    await flush();
    expect(cleared).toBe(clearedBefore + 1);
    expect(wl.release).toHaveBeenCalled();
    s.tick();
    expect(seen.filter((t) => t === 'finished')).toHaveLength(1);
    unsub();
    const n = seen.length;
    s.tick();
    expect(seen).toHaveLength(n);
  });

  it('wake lock is acquired on start/resume and released on pause', () => {
    const s = useSessionStore.getState();
    s.load(makeRuntime());
    s.start();
    expect(wl.acquire).toHaveBeenCalledTimes(1);
    now = 3000;
    s.tick();
    s.pause();
    expect(wl.release).toHaveBeenCalledTimes(1);
    s.resume();
    expect(wl.acquire).toHaveBeenCalledTimes(2);
  });

  it('autosaves immediately on pause and on segment change, never during countdown', async () => {
    const plan = { planId: 'p', week: 2, slot: 'progres' as const };
    const s = useSessionStore.getState();
    s.load(makeRuntime(plan));
    s.start();
    now = 1000;
    s.tick();
    expect(saved).toHaveLength(0);
    now = 3000;
    s.tick();
    now = 5000;
    await flush();
    const beforePause = saved.length; // first running tick saves once
    s.pause();
    await flush();
    expect(saved).toHaveLength(beforePause + 1);
    const last = saved.at(-1);
    expect(last?.snapshot.status).toBe('paused');
    expect(last?.plan).toEqual(plan);
    expect(last?.workoutId).toBe('w1');
    expect(saved.every((a) => a.snapshot.workoutElapsedSec >= 0)).toBe(true);
    s.resume();
    now = 14000;
    s.tick();
    await flush();
    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(saved.at(-1)?.snapshot.segmentIndex).toBe(1);
  });
});

describe('session store resilience', () => {
  it('a throwing listener does not abort tick; finish still clears and releases', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const s = useSessionStore.getState();
    const seen: string[] = [];
    const u1 = subscribeSessionEvents(() => {
      throw new Error('boom');
    });
    const u2 = subscribeSessionEvents((e) => seen.push(e.type));
    s.load(makeRuntime());
    s.start();
    now = 3000;
    s.tick();
    now = 30000;
    const clearedBefore = cleared;
    const releasedBefore = wl.release.mock.calls.length;
    expect(() => s.tick()).not.toThrow();
    expect(seen).toContain('finished');
    await flush();
    expect(cleared).toBe(clearedBefore + 1);
    expect(wl.release.mock.calls.length).toBeGreaterThan(releasedBefore);
    expect(err).toHaveBeenCalled();
    u1();
    u2();
    err.mockRestore();
  });

  it('a late save never lands after clear', async () => {
    const order: string[] = [];
    let releaseSave: () => void = () => undefined;
    configureSessionSideEffects({
      wakeLock: wl,
      save: () =>
        new Promise<void>((res) => {
          releaseSave = () => {
            order.push('save');
            res();
          };
        }),
      clear: async () => {
        order.push('clear');
      },
    });
    const s = useSessionStore.getState();
    s.load(makeRuntime());
    s.start();
    now = 3000;
    s.tick();
    now = 4000;
    s.tick(); // first running tick starts a slow save
    s.pause(); // queued second save
    await flush(); // the first save is now in flight
    s.stop(); // clear queued behind the slow save; pending save dropped
    releaseSave();
    await vi.waitFor(() => expect(order).toContain('clear'));
    expect(order.at(-1)).toBe('clear');
    expect(order.filter((o) => o === 'save')).toHaveLength(1);
  });

  it('logs rejected saves and synchronous throws instead of swallowing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    configureSessionSideEffects({
      wakeLock: wl,
      save: async () => {
        throw new Error('disk');
      },
      clear: () => {
        throw new Error('sync');
      },
    });
    const s = useSessionStore.getState();
    s.load(makeRuntime());
    s.start();
    now = 3000;
    s.tick();
    now = 4000;
    s.tick();
    await flush();
    s.stop();
    await vi.waitFor(() => expect(warn.mock.calls.length).toBeGreaterThanOrEqual(2));
    warn.mockRestore();
  });

  it('load over a running session releases the lock and drops its autosave', async () => {
    const s = useSessionStore.getState();
    s.load(makeRuntime());
    s.start();
    now = 3000;
    s.tick();
    const releases = wl.release.mock.calls.length;
    const clears = cleared;
    s.load(makeRuntime());
    expect(wl.release.mock.calls.length).toBeGreaterThan(releases);
    await flush();
    expect(cleared).toBe(clears + 1);
    expect(useSessionStore.getState().state.status).toBe('idle');
  });

  it('load with a snapshot over a running session keeps the stored record', async () => {
    const s = useSessionStore.getState();
    s.load(makeRuntime());
    s.start();
    const clears = cleared;
    s.load(makeRuntime(), { segmentIndex: 0, workoutElapsedSec: 2, status: 'paused' });
    await flush();
    expect(cleared).toBe(clears);
    expect(useSessionStore.getState().state.status).toBe('paused');
  });
});

describe('createAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeStore(status: 'running' | 'paused' | 'idle' | 'finished'): SessionStore {
    return {
      runtime: makeRuntime(),
      state: {
        status,
        segmentIndex: 0,
        workoutElapsedSec: 4,
        segmentElapsedSec: 4,
        segmentRemainingSec: 6,
      },
    } as unknown as SessionStore;
  }

  it('saves every interval while running and not between', () => {
    const save = vi.fn(async () => undefined);
    const a = createAutosave({ save, clear: async () => undefined });
    const st = fakeStore('running');
    a.onTick(st);
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4000);
    a.onTick(st);
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    a.onTick(st);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('honours a custom interval, ignores non-running ticks, and onEvent saves immediately', () => {
    const save = vi.fn(async () => undefined);
    const a = createAutosave({ save, clear: async () => undefined, intervalMs: 1000 });
    a.onTick(fakeStore('idle'));
    a.onTick(fakeStore('finished'));
    expect(save).not.toHaveBeenCalled();
    a.onTick(fakeStore('paused'));
    expect(save).not.toHaveBeenCalled();
    a.onEvent();
    expect(save).toHaveBeenCalledTimes(1);
    a.onTick(fakeStore('idle'));
    a.onEvent();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('dispose stops saving', () => {
    const save = vi.fn(async () => undefined);
    const a = createAutosave({ save, clear: async () => undefined });
    a.dispose();
    a.onTick(fakeStore('running'));
    a.onEvent(fakeStore('running'));
    expect(save).not.toHaveBeenCalled();
  });

  it('swallows save failures', () => {
    const save = vi.fn(async () => {
      throw new Error('disk');
    });
    const a = createAutosave({ save, clear: async () => undefined });
    expect(() => a.onTick(fakeStore('running'))).not.toThrow();
  });
});
