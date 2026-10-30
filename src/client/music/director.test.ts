import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineEvent, EngineState } from '../../domain/session-engine';
import type { Segment } from '../../domain/segments';
import type { MusicCue, TrackRef } from '../../domain/workout';
import { createMusicDirector, type MusicDirectorOptions } from './director';
import { createFakeMusicProvider, type FakeMusicProvider } from './fake-provider';
import type { MusicProvider } from './types';

const seg = (index: number, startSec: number, durationSec: number, blockId: string): Segment => ({
  index,
  startSec,
  durationSec,
  kind: 'steady',
  ftpPctStart: 70,
  ftpPctEnd: 70,
  effortStart: 4,
  effortEnd: 4,
  blockId,
  rep: 1,
  reps: 1,
});

const track = (
  id: string,
  provider: TrackRef['provider'] = 'spotify',
  durationSec?: number,
): TrackRef => ({
  provider,
  id,
  title: `Title ${id}`,
  startAtSec: 0,
  ...(durationSec !== undefined ? { durationSec } : {}),
});
const cue = (blockId: string, t: TrackRef): MusicCue => ({ blockId, rep: 1, track: t });

// a 0-100, b 100-300, c 300-600
const segments: Segment[] = [seg(0, 0, 100, 'a'), seg(1, 100, 200, 'b'), seg(2, 300, 300, 'c')];

/** A read-only stand-in for the engine whose state the tests move by hand. */
function createHarness() {
  let state: EngineState = {
    status: 'idle',
    segmentIndex: 0,
    workoutElapsedSec: 0,
    segmentElapsedSec: 0,
    segmentRemainingSec: 100,
  };
  const eventListeners = new Set<(e: EngineEvent, s: EngineState) => void>();
  const stateListeners = new Set<() => void>();
  return {
    get state() {
      return state;
    },
    set(patch: Partial<EngineState>) {
      state = { ...state, ...patch };
      for (const l of [...stateListeners]) l();
    },
    emit(e: EngineEvent) {
      for (const l of [...eventListeners]) l(e, state);
    },
    options: {
      getState: () => state,
      subscribeEvents(cb) {
        eventListeners.add(cb);
        return () => eventListeners.delete(cb);
      },
      subscribeState(cb) {
        stateListeners.add(cb);
        return () => stateListeners.delete(cb);
      },
    } satisfies Pick<MusicDirectorOptions, 'getState' | 'subscribeEvents' | 'subscribeState'>,
    listenerCount: () => eventListeners.size + stateListeners.size,
  };
}

let engine: ReturnType<typeof createHarness>;
let spotify: FakeMusicProvider;
let youtube: FakeMusicProvider;
let warnings: TrackRef[];

function make(overrides: Partial<MusicDirectorOptions> = {}) {
  return createMusicDirector({
    segments,
    cues: [],
    fallback: [],
    getProvider: (kind) => (kind === 'spotify' ? spotify : youtube),
    onWarning: (t) => warnings.push(t),
    ...engine.options,
    ...overrides,
  });
}

/** Lets the director's promise chain settle without moving the fake clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** Puts the engine at `t` seconds, running, and notifies like a segment change would. */
async function runAt(t: number) {
  engine.set({ status: 'running', workoutElapsedSec: t });
  engine.emit({ type: 'segmentChanged', from: 0, to: 0, skipped: true });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  engine = createHarness();
  spotify = createFakeMusicProvider({ kind: 'spotify' });
  youtube = createFakeMusicProvider({ kind: 'youtube' });
  warnings = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('music director: idle and start', () => {
  it('stays idle without cues or a fallback playlist', async () => {
    const director = make();
    director.start();
    await runAt(10);
    expect(engine.listenerCount()).toBe(0);
    expect(spotify.log).toEqual([]);
    director.dispose();
  });

  it('does not play while the engine is idle or counting down', async () => {
    make({ fallback: [track('F')] }).start();
    engine.set({ status: 'countdown' });
    await advance(3000);
    expect(spotify.log).toEqual([]);
  });

  it('starts the fallback track from its beginning when the workout runs', async () => {
    make({ fallback: [track('F')] }).start();
    await runAt(0);
    expect(spotify.log).toEqual(['play:F@0']);
  });

  it('starts a cue track at its offset when already running at start', async () => {
    engine.set({ status: 'running', workoutElapsedSec: 130 });
    make({ cues: [cue('b', track('B'))] }).start();
    await settle();
    expect(spotify.log).toEqual(['play:B@30']);
  });

  it('does nothing when the desired track has not changed', async () => {
    make({ cues: [cue('a', track('A'))] }).start();
    await runAt(0);
    await runAt(50);
    engine.emit({ type: 'segmentChanged', from: 0, to: 0, skipped: false });
    await advance(5000);
    expect(spotify.log).toEqual(['play:A@0']);
  });

  it('picks the provider by the track kind', async () => {
    make({ cues: [cue('a', track('A', 'youtube')), cue('b', track('B', 'spotify'))] }).start();
    await runAt(0);
    await runAt(100);
    await advance(1500);
    expect(youtube.log).toEqual(['play:A@0', 'fadeOut:1500']);
    expect(spotify.log).toEqual(['play:B@0']);
  });

  it('connects a provider that is not ready before playing', async () => {
    const cold = createFakeMusicProvider({ kind: 'youtube', ready: false });
    make({ fallback: [track('F', 'youtube')], getProvider: () => cold }).start();
    await runAt(0);
    expect(cold.log).toEqual(['connect', 'play:F@0']);
  });
});

describe('music director: cue cuts', () => {
  it('fades the old track out for 1.5 s and then plays the new one', async () => {
    const slow = createFakeMusicProvider({ fadeDurationMs: 1500 });
    make({ cues: [cue('a', track('A')), cue('b', track('B'))], getProvider: () => slow }).start();
    await runAt(0);
    expect(slow.log).toEqual(['play:A@0']);

    await runAt(100); // the cue for block b begins
    expect(slow.log).toEqual(['play:A@0', 'fadeOut:1500']);
    await advance(1499);
    expect(slow.log).toEqual(['play:A@0', 'fadeOut:1500']);
    // The fade took 1.5 s of the workout, so B starts that far into its cue.
    engine.set({ workoutElapsedSec: 101.5 });
    await advance(1);
    expect(slow.log).toEqual(['play:A@0', 'fadeOut:1500', 'play:B@2']);
  });

  it('is triggered by the segment change event as well as the poll', async () => {
    make({ cues: [cue('a', track('A')), cue('b', track('B'))] }).start();
    await runAt(0);
    engine.set({ workoutElapsedSec: 100 }); // same status: only the event can notice
    engine.emit({ type: 'segmentChanged', from: 0, to: 1, skipped: false });
    await settle();
    expect(spotify.log).toEqual(['play:A@0', 'fadeOut:1500', 'play:B@0']);
  });

  it('is noticed by the 1 s poll when no event arrives', async () => {
    make({ cues: [cue('a', track('A')), cue('b', track('B'))] }).start();
    await runAt(0);
    engine.set({ workoutElapsedSec: 100 });
    await advance(1000);
    expect(spotify.log).toEqual(['play:A@0', 'fadeOut:1500', 'play:B@0']);
  });

  it('moves on to the fallback track when a cue track ends', async () => {
    make({ cues: [cue('a', track('A', 'spotify', 50))], fallback: [track('F')] }).start();
    await runAt(0);
    await runAt(60);
    expect(spotify.log).toEqual(['play:A@0', 'fadeOut:1500', 'play:F@10']);
  });

  it('fades out when nothing is scheduled any more', async () => {
    make({ cues: [cue('a', track('A', 'spotify', 50))] }).start();
    await runAt(0);
    await runAt(60);
    expect(spotify.log).toEqual(['play:A@0', 'fadeOut:1500']);
  });

  it('fades out when the workout finishes', async () => {
    make({ cues: [cue('a', track('A'))] }).start();
    await runAt(0);
    engine.set({ status: 'finished', workoutElapsedSec: 600 });
    engine.emit({ type: 'finished' });
    await settle();
    expect(spotify.log).toEqual(['play:A@0', 'fadeOut:1500']);
  });
});

describe('music director: pause, resume and seek', () => {
  it('pauses with the engine and resumes the same track', async () => {
    make({ cues: [cue('a', track('A'))] }).start();
    await runAt(0);
    engine.set({ status: 'paused' });
    await settle();
    expect(spotify.log).toEqual(['play:A@0', 'pause']);
    await advance(5000); // polling while paused does not repeat the pause
    engine.set({ status: 'running', workoutElapsedSec: 20 });
    await settle();
    expect(spotify.log).toEqual(['play:A@0', 'pause', 'resume']);
  });

  it('plays the new track without a fade when it changed during the pause', async () => {
    make({ cues: [cue('a', track('A')), cue('b', track('B'))] }).start();
    await runAt(0);
    engine.set({ status: 'paused' });
    await settle();
    engine.set({ workoutElapsedSec: 150 }); // skipped ahead while paused
    await advance(2000);
    expect(spotify.log).toEqual(['play:A@0', 'pause']);
    engine.set({ status: 'running' });
    await settle();
    expect(spotify.log).toEqual(['play:A@0', 'pause', 'play:B@50']);
  });

  it('pauses when the engine returns to idle', async () => {
    make({ cues: [cue('a', track('A'))] }).start();
    await runAt(0);
    engine.set({ status: 'idle' });
    await settle();
    expect(spotify.log).toEqual(['play:A@0', 'pause']);
  });

  it('a forward seek replays the right track at the right offset', async () => {
    make({ cues: [cue('a', track('A')), cue('b', track('B', 'spotify', 1000))] }).start();
    await runAt(10);
    expect(spotify.log).toEqual(['play:A@10']);
    engine.set({ workoutElapsedSec: 240 });
    engine.emit({ type: 'segmentChanged', from: 0, to: 1, skipped: true });
    await settle();
    expect(spotify.log).toEqual(['play:A@10', 'fadeOut:1500', 'play:B@140']);
  });

  it('a backward seek returns to the earlier track', async () => {
    make({ cues: [cue('a', track('A')), cue('b', track('B'))] }).start();
    await runAt(150);
    expect(spotify.log).toEqual(['play:B@50']);
    engine.set({ workoutElapsedSec: 30 });
    engine.emit({ type: 'segmentChanged', from: 1, to: 0, skipped: true });
    await settle();
    expect(spotify.log).toEqual(['play:B@50', 'fadeOut:1500', 'play:A@30']);
  });

  it('a seek inside the same track leaves it playing', async () => {
    make({ cues: [cue('b', track('B'))] }).start();
    await runAt(150);
    engine.set({ workoutElapsedSec: 250 });
    engine.emit({ type: 'segmentChanged', from: 1, to: 1, skipped: true });
    await settle();
    expect(spotify.log).toEqual(['play:B@50']);
  });

  it('handles a seek that arrives during a fade without overlapping calls', async () => {
    const slow = createFakeMusicProvider({ fadeDurationMs: 1500 });
    make({
      cues: [cue('a', track('A')), cue('b', track('B')), cue('c', track('C'))],
      getProvider: () => slow,
    }).start();
    await runAt(0);
    await runAt(100);
    expect(slow.log).toEqual(['play:A@0', 'fadeOut:1500']);
    engine.set({ workoutElapsedSec: 310 }); // jumps again while B's fade is under way
    engine.emit({ type: 'segmentChanged', from: 1, to: 2, skipped: true });
    await advance(1500);
    expect(slow.log).toEqual(['play:A@0', 'fadeOut:1500', 'play:C@10']);
  });

  it('keeps the music silent when the engine pauses during a fade', async () => {
    const slow = createFakeMusicProvider({ fadeDurationMs: 1500 });
    make({ cues: [cue('a', track('A')), cue('b', track('B'))], getProvider: () => slow }).start();
    await runAt(0);
    await runAt(100);
    engine.set({ status: 'paused' });
    await advance(2000);
    expect(slow.log).toEqual(['play:A@0', 'fadeOut:1500']);
    engine.set({ status: 'running', workoutElapsedSec: 105 });
    await settle();
    expect(slow.log).toEqual(['play:A@0', 'fadeOut:1500', 'play:B@5']);
  });
});

describe('music director: failures (review focus #5)', () => {
  it('one rejection: one warning, one retry after 3 s, engine state unchanged', async () => {
    spotify.failNextPlays(1);
    make({ cues: [cue('a', track('A'))] }).start();
    engine.set({ status: 'running', workoutElapsedSec: 5 });
    const before = engine.state;
    await settle();
    expect(spotify.log).toEqual(['play:A@5']);
    expect(warnings.map((w) => w.id)).toEqual(['A']);

    await advance(2999);
    expect(spotify.log).toEqual(['play:A@5']);
    engine.set({ workoutElapsedSec: 8 });
    await advance(1);
    // The retry starts at the offset of the moment it happens.
    expect(spotify.log).toEqual(['play:A@5', 'play:A@8']);
    expect(warnings).toHaveLength(1);

    // Nothing here ever wrote to the engine.
    expect(engine.state).toEqual({ ...before, workoutElapsedSec: 8 });
    expect(engine.state.status).toBe('running');
  });

  it('polling during the wait does not retry early', async () => {
    spotify.failNextPlays(1);
    make({ cues: [cue('a', track('A'))] }).start();
    await runAt(5);
    await advance(2900);
    expect(spotify.log).toEqual(['play:A@5']);
  });

  it('a second failure gives up on that track without another warning', async () => {
    spotify.failNextPlays(2);
    make({ cues: [cue('a', track('A'))] }).start();
    await runAt(5);
    await advance(3000);
    expect(spotify.log).toEqual(['play:A@5', 'play:A@5']);
    await advance(60_000);
    expect(spotify.log).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });

  it('a later track gets its own warning and retry', async () => {
    spotify.failPlaysWhen(() => true);
    make({ cues: [cue('a', track('A')), cue('b', track('B'))] }).start();
    await runAt(0);
    await advance(3000);
    await runAt(100);
    await advance(3000);
    expect(spotify.log).toEqual(['play:A@0', 'play:A@0', 'play:B@0', 'play:B@0']);
    expect(warnings.map((w) => w.id)).toEqual(['A', 'B']);
  });

  it('a successful retry plays on and warns only once', async () => {
    spotify.failNextPlays(1);
    make({ cues: [cue('a', track('A'))] }).start();
    await runAt(0);
    await advance(3000);
    await advance(10_000);
    expect(spotify.log).toEqual(['play:A@0', 'play:A@0']);
    expect(warnings).toHaveLength(1);
  });

  it('a missing provider counts as a failed track', async () => {
    make({ cues: [cue('a', track('A'))], getProvider: () => undefined }).start();
    await runAt(0);
    expect(warnings.map((w) => w.id)).toEqual(['A']);
    await advance(10_000);
    expect(warnings).toHaveLength(1);
  });

  it('a failing connect counts as a failed track', async () => {
    const cold = createFakeMusicProvider({ ready: false });
    cold.failConnect(true);
    make({ cues: [cue('a', track('A'))], getProvider: () => cold }).start();
    await runAt(0);
    expect(warnings).toHaveLength(1);
    expect(cold.log).toEqual(['connect']);
    await advance(3000);
    expect(cold.log).toEqual(['connect', 'connect']);
    await advance(30_000);
    expect(cold.log).toEqual(['connect', 'connect']);
  });

  it('a failed track does not stop the next cue from playing', async () => {
    spotify.failPlaysWhen((t) => t.id === 'A');
    make({ cues: [cue('a', track('A')), cue('b', track('B'))] }).start();
    await runAt(0);
    await runAt(100);
    expect(spotify.log).toEqual(['play:A@0', 'play:B@0']);
  });

  it('survives a rejecting fadeOut and pause', async () => {
    const flaky: MusicProvider = {
      ...createFakeMusicProvider(),
      fadeOut: () => Promise.reject(new Error('fade')),
      pause: () => Promise.reject(new Error('pause')),
    };
    const play = vi.fn(() => Promise.resolve());
    make({
      cues: [cue('a', track('A')), cue('b', track('B'))],
      getProvider: () => ({ ...flaky, play }),
    }).start();
    await runAt(0);
    await runAt(100);
    expect(play).toHaveBeenCalledTimes(2);
    engine.set({ status: 'paused' });
    await settle();
    expect(warnings).toHaveLength(0);
  });

  it('plays the track again when resume fails', async () => {
    const base = createFakeMusicProvider();
    const failing: MusicProvider = { ...base, resume: () => Promise.reject(new Error('gone')) };
    make({ cues: [cue('a', track('A'))], getProvider: () => failing }).start();
    await runAt(0);
    engine.set({ status: 'paused' });
    await settle();
    engine.set({ status: 'running', workoutElapsedSec: 40 });
    await settle();
    expect(base.log).toEqual(['play:A@0', 'pause', 'play:A@40']);
  });
});

describe('music director: dispose', () => {
  it('pauses what is playing and stops reacting', async () => {
    const director = make({ cues: [cue('a', track('A')), cue('b', track('B'))] });
    director.start();
    await runAt(0);
    director.dispose();
    await settle();
    expect(spotify.log).toEqual(['play:A@0', 'pause']);
    expect(engine.listenerCount()).toBe(0);
    engine.set({ workoutElapsedSec: 150 });
    await advance(5000);
    expect(spotify.log).toEqual(['play:A@0', 'pause']);
  });

  it('cancels a pending retry', async () => {
    spotify.failNextPlays(1);
    const director = make({ cues: [cue('a', track('A'))] });
    director.start();
    await runAt(0);
    director.dispose();
    await advance(10_000);
    expect(spotify.log).toEqual(['play:A@0']);
  });

  it('stops a track that finished starting after dispose', async () => {
    let finish: () => void = () => undefined;
    const base = createFakeMusicProvider();
    const late: MusicProvider = {
      ...base,
      play: () => new Promise<void>((resolve) => (finish = resolve)),
    };
    const director = make({ cues: [cue('a', track('A'))], getProvider: () => late });
    director.start();
    await runAt(0);
    director.dispose();
    finish();
    await settle();
    expect(base.log).toEqual(['pause']);
  });
});
