import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineEvent, EngineState } from '../../domain/session-engine';
import type { Segment } from '../../domain/segments';
import type { MusicCue, TrackRef } from '../../domain/workout';
import {
  CONNECT_TIMEOUT_MS,
  CONTROL_TIMEOUT_MS,
  FADE_SLACK_MS,
  PLAY_TIMEOUT_MS,
  createMusicDirector,
  type MusicDirectorOptions,
} from './director';
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

describe('music director: gap between songs', () => {
  it('uses the short switch fade between two songs', async () => {
    const quick = createFakeMusicProvider({ fadeDurationMs: 300 });
    make({
      cues: [cue('a', track('A')), cue('b', track('B'))],
      getProvider: () => quick,
      switchFadeMs: 300,
    }).start();
    await runAt(0);
    await runAt(100);
    await advance(300);
    expect(quick.log).toEqual(['play:A@0', 'fadeOut:300', 'play:B@0']);
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

    // The director has no write path to the engine; TrainingScreen.music.test.tsx shows the real
    // session store carrying on while a provider fails.
    expect(engine.state.status).toBe(before.status);
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

describe('music director: a hung provider call', () => {
  const never = () => new Promise<void>(() => undefined);

  it('a play that never settles times out: one warning, one retry, then silence', async () => {
    const hung: MusicProvider = { ...createFakeMusicProvider(), play: vi.fn(never) };
    make({ cues: [cue('a', track('A'))], getProvider: () => hung }).start();
    await runAt(0);
    expect(hung.play).toHaveBeenCalledTimes(1);
    expect(warnings).toHaveLength(0);

    await advance(PLAY_TIMEOUT_MS - 1);
    expect(warnings).toHaveLength(0);
    await advance(1);
    expect(warnings.map((w) => w.id)).toEqual(['A']);

    await advance(3000); // the retry, which hangs again
    expect(hung.play).toHaveBeenCalledTimes(2);
    await advance(PLAY_TIMEOUT_MS);
    await advance(60_000);
    expect(hung.play).toHaveBeenCalledTimes(2);
    expect(warnings).toHaveLength(1);
  });

  it('a hung play does not stop later cues from being followed', async () => {
    const base = createFakeMusicProvider();
    const hungOnA: MusicProvider = {
      ...base,
      play: (t, offset) => (t.id === 'A' ? never() : base.play(t, offset)),
    };
    make({
      cues: [cue('a', track('A')), cue('b', track('B'))],
      getProvider: () => hungOnA,
    }).start();
    await runAt(0);
    await advance(PLAY_TIMEOUT_MS);
    await runAt(100);
    expect(base.log).toEqual(['play:B@0']);
  });

  it('pauses a timed-out play that succeeds later', async () => {
    let finish: () => void = () => undefined;
    const base = createFakeMusicProvider();
    const slow: MusicProvider = {
      ...base,
      play: () => new Promise<void>((resolve) => (finish = resolve)),
    };
    make({ cues: [cue('a', track('A'))], getProvider: () => slow }).start();
    await runAt(0);
    await advance(PLAY_TIMEOUT_MS);
    expect(warnings).toHaveLength(1);
    finish();
    await settle();
    expect(base.log).toEqual(['pause']);
  });

  it('ignores the late success of a play that a newer play has replaced', async () => {
    const finishers: (() => void)[] = [];
    const base = createFakeMusicProvider();
    const slow: MusicProvider = {
      ...base,
      play: () => new Promise<void>((resolve) => finishers.push(resolve)),
    };
    make({ cues: [cue('a', track('A'))], getProvider: () => slow }).start();
    await runAt(0);
    await advance(PLAY_TIMEOUT_MS + 3000); // first play timed out, the retry is now in flight
    expect(finishers).toHaveLength(2);
    finishers[0]?.(); // stale
    await settle();
    expect(base.log).toEqual([]); // not paused: the retry is the live one
    finishers[1]?.();
    await settle();
    // The retry finished in time and is now what plays; polling leaves it alone.
    await advance(5000);
    expect(base.log).toEqual([]);
  });

  it('a connect that never settles times out like a failed track', async () => {
    const base = createFakeMusicProvider({ ready: false });
    const hung: MusicProvider = { ...base, connect: vi.fn(never) };
    make({ cues: [cue('a', track('A'))], getProvider: () => hung }).start();
    await runAt(0);
    await advance(CONNECT_TIMEOUT_MS);
    expect(warnings.map((w) => w.id)).toEqual(['A']);
    await advance(3000);
    expect(hung.connect).toHaveBeenCalledTimes(2);
    expect(base.log).toEqual([]);
  });

  it('a fadeOut that never settles still lets the next track start', async () => {
    const base = createFakeMusicProvider();
    const hungFade: MusicProvider = { ...base, fadeOut: vi.fn(never) };
    make({
      cues: [cue('a', track('A')), cue('b', track('B'))],
      getProvider: () => hungFade,
    }).start();
    await runAt(0);
    await runAt(100);
    expect(base.log).toEqual(['play:A@0']);
    await advance(1500 + FADE_SLACK_MS);
    expect(base.log).toEqual(['play:A@0', 'play:B@0']);
    expect(warnings).toHaveLength(0);
  });

  it('a pause that never settles does not block resuming', async () => {
    const base = createFakeMusicProvider();
    const hungPause: MusicProvider = { ...base, pause: vi.fn(never) };
    make({ cues: [cue('a', track('A'))], getProvider: () => hungPause }).start();
    await runAt(0);
    engine.set({ status: 'paused' });
    await settle();
    engine.set({ status: 'running', workoutElapsedSec: 10 });
    await advance(CONTROL_TIMEOUT_MS);
    expect(base.log).toEqual(['play:A@0', 'resume']);
  });

  it('a resume that never settles replays the track', async () => {
    const base = createFakeMusicProvider();
    const hungResume: MusicProvider = { ...base, resume: vi.fn(never) };
    make({ cues: [cue('a', track('A'))], getProvider: () => hungResume }).start();
    await runAt(0);
    engine.set({ status: 'paused' });
    await settle();
    engine.set({ status: 'running', workoutElapsedSec: 10 });
    await advance(CONTROL_TIMEOUT_MS);
    await advance(1000);
    expect(base.log).toEqual(['play:A@0', 'pause', 'play:A@10']);
  });
});

describe('music director: retry and dispose edge cases', () => {
  it('a retry that comes due while paused waits for the resume', async () => {
    spotify.failNextPlays(1);
    make({ cues: [cue('a', track('A'))] }).start();
    await runAt(5);
    engine.set({ status: 'paused' });
    await advance(10_000);
    expect(spotify.log).toEqual(['play:A@5']);
    engine.set({ status: 'running', workoutElapsedSec: 20 });
    await settle();
    expect(spotify.log).toEqual(['play:A@5', 'play:A@20']);
    expect(warnings).toHaveLength(1);
  });

  it('dispose during a fade starts nothing afterwards', async () => {
    const slow = createFakeMusicProvider({ fadeDurationMs: 1500 });
    const director = make({
      cues: [cue('a', track('A')), cue('b', track('B'))],
      getProvider: () => slow,
    });
    director.start();
    await runAt(0);
    await runAt(100);
    director.dispose();
    await advance(5000);
    expect(slow.log).toEqual(['play:A@0', 'fadeOut:1500']);
  });

  it('dispose during connect plays nothing and warns about nothing', async () => {
    let connected: () => void = () => undefined;
    const base = createFakeMusicProvider({ ready: false });
    const connecting: MusicProvider = {
      ...base,
      connect: () => new Promise<void>((resolve) => (connected = resolve)),
    };
    const director = make({ cues: [cue('a', track('A'))], getProvider: () => connecting });
    director.start();
    await runAt(0);
    director.dispose();
    connected();
    await advance(PLAY_TIMEOUT_MS * 2);
    expect(base.log).toEqual([]);
    expect(warnings).toHaveLength(0);
  });

  it('a play rejected because of dispose gives no warning and arms no retry', async () => {
    let fail: (e: Error) => void = () => undefined;
    const base = createFakeMusicProvider();
    const failing: MusicProvider = {
      ...base,
      play: () => new Promise<void>((_, reject) => (fail = reject)),
    };
    const director = make({ cues: [cue('a', track('A'))], getProvider: () => failing });
    director.start();
    await runAt(0);
    director.dispose();
    fail(new Error('player disposed'));
    await advance(10_000);
    expect(warnings).toHaveLength(0);
  });

  it('a step that throws is recovered by the next trigger', async () => {
    let calls = 0;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    make({
      cues: [cue('a', track('A'))],
      getState: () => {
        calls += 1;
        if (calls === 2) throw new Error('state unavailable');
        return engine.state;
      },
    }).start();
    engine.set({ status: 'running', workoutElapsedSec: 0 });
    await settle();
    await advance(1000);
    expect(errors).toHaveBeenCalled();
    expect(spotify.log).toEqual(['play:A@0']);
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

describe('music director: volume and now playing', () => {
  it('reports the playing track and clears it when the track changes or ends', async () => {
    const seen: (string | null)[] = [];
    make({
      cues: [cue('a', track('A')), cue('b', track('B'))],
      onPlaying: (t) => seen.push(t?.id ?? null),
    }).start();
    await runAt(0);
    expect(seen).toEqual(['A']);
    await runAt(150);
    expect(seen).toEqual(['A', null, 'B']);
  });

  it('applies a volume change to the current track, ignoring repeats', async () => {
    const director = make({ fallback: [track('F')] });
    director.start();
    await runAt(0);
    director.setVolume(0);
    await settle();
    director.setVolume(0);
    director.setVolume(1);
    await settle();
    expect(spotify.log).toEqual(['play:F@0', 'setVolume:0', 'setVolume:1']);
  });

  it('starts the next track at the muted level and clamps odd values', async () => {
    const director = make({ fallback: [track('F')], volume: 0 });
    director.start();
    await runAt(0);
    expect(spotify.log).toEqual(['setVolume:0', 'play:F@0']);
    director.setVolume(7);
    await settle();
    expect(spotify.log.at(-1)).toBe('setVolume:1');
  });

  it('hands the failure to the warning callback', async () => {
    spotify.failPlaysWhen(() => true);
    const errors: unknown[] = [];
    make({
      fallback: [track('F')],
      onWarning: (t, err) => {
        warnings.push(t);
        errors.push(err);
      },
    }).start();
    await runAt(0);
    expect(warnings).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });
});

describe('music director: missing titles', () => {
  const bare = (id: string): TrackRef => ({ provider: 'spotify', id, title: '', startAtSec: 0 });

  it('announces the track again with the name the provider resolves', async () => {
    const seen: TrackRef[] = [];
    spotify = createFakeMusicProvider({
      kind: 'spotify',
      describe: () => Promise.resolve({ title: 'Real Name', artist: 'Some Band' }),
    });
    make({ fallback: [bare('X')], onPlaying: (t) => t && seen.push(t) }).start();
    await runAt(0);
    expect(seen.map((t) => t.title)).toEqual(['', 'Real Name']);
    expect(seen[1]).toMatchObject({ id: 'X', artist: 'Some Band' });
  });

  it('does not ask for a track that already has a title', async () => {
    const describe = vi.fn(() => Promise.resolve({ title: 'Other' }));
    spotify = createFakeMusicProvider({ kind: 'spotify', describe });
    make({ fallback: [track('T')] }).start();
    await runAt(0);
    expect(describe).not.toHaveBeenCalled();
  });

  it('plays without waiting for the lookup, and survives one that never settles', async () => {
    const seen: (string | null)[] = [];
    spotify = createFakeMusicProvider({ kind: 'spotify', describe: () => new Promise(() => {}) });
    make({ fallback: [bare('X')], onPlaying: (t) => seen.push(t?.title ?? null) }).start();
    await runAt(0);
    expect(spotify.log).toEqual(['play:X@0']);
    await advance(CONTROL_TIMEOUT_MS + 1000);
    expect(seen).toEqual(['']);
    expect(warnings).toEqual([]);
  });

  it('survives a lookup that fails', async () => {
    const seen: (string | null)[] = [];
    spotify = createFakeMusicProvider({
      kind: 'spotify',
      describe: () => Promise.reject(new Error('nope')),
    });
    make({ fallback: [bare('Y')], onPlaying: (t) => seen.push(t?.title ?? null) }).start();
    await runAt(0);
    expect(seen).toEqual(['']);
    expect(warnings).toEqual([]);
  });

  it('drops a name that arrives after the track has changed', async () => {
    const seen: (string | null)[] = [];
    let resolve: (v: { title: string }) => void = () => undefined;
    spotify = createFakeMusicProvider({
      kind: 'spotify',
      describe: () => new Promise((r) => (resolve = r)),
    });
    make({
      cues: [cue('a', bare('A')), cue('b', track('B'))],
      onPlaying: (t) => seen.push(t?.title ?? null),
    }).start();
    await runAt(0);
    await runAt(150);
    resolve({ title: 'Late' });
    await settle();
    expect(seen).not.toContain('Late');
  });
});

describe('music director: closing silence', () => {
  // total 600 s; silence for the last 60 s => from 540 s
  it('fades the track out when the silence window opens and stays quiet to the end', async () => {
    make({ cues: [cue('c', track('C'))], silenceLastSec: 60, fadeMs: 1500 }).start();
    await runAt(300);
    await runAt(539);
    expect(spotify.log).toEqual(['play:C@0']);
    await runAt(540);
    await advance(1500);
    expect(spotify.log).toEqual(['play:C@0', 'fadeOut:1500']);
    await runAt(580);
    await advance(5000);
    expect(spotify.log).toEqual(['play:C@0', 'fadeOut:1500']);
  });

  it('does not start a track inside the silence window', async () => {
    make({ cues: [cue('c', track('C'))], silenceLastSec: 60 }).start();
    await runAt(560);
    expect(spotify.log).toEqual([]);
  });

  it('is off by default', async () => {
    make({ cues: [cue('c', track('C'))] }).start();
    await runAt(580);
    expect(spotify.log).toEqual(['play:C@280']);
  });

  it('a provider that fails to fade does not break the director or throw', async () => {
    spotify.fadeOut = () => Promise.reject(new Error('fade failed'));
    const director = make({ cues: [cue('c', track('C'))], silenceLastSec: 60 });
    director.start();
    await runAt(300);
    await runAt(545);
    await advance(5000);
    expect(console.warn).toHaveBeenCalled();
    expect(() => director.dispose()).not.toThrow();
  });
});

describe('music director: slot queue', () => {
  const queued: MusicCue = {
    blockId: 'b',
    rep: 1,
    track: track('Q1', 'spotify', 120),
    queue: [track('Q2', 'spotify', 100)],
  };

  it('starts the next queued track as soon as the first one ends', async () => {
    make({ cues: [queued] }).start();
    await runAt(100);
    expect(spotify.log).toEqual(['play:Q1@0']);
    await runAt(219);
    expect(spotify.log).toEqual(['play:Q1@0']);
    await runAt(220);
    await advance(1500);
    expect(spotify.log).toContain('play:Q2@0');
  });

  it('wakes at the track boundary without waiting for the poll', async () => {
    engine.set({ status: 'running', workoutElapsedSec: 219.6 });
    make({ cues: [queued], pollMs: 60_000 }).start();
    await settle();
    expect(spotify.log).toEqual(['play:Q1@120']);
    engine.set({ workoutElapsedSec: 220 });
    await advance(500);
    await advance(1500);
    expect(spotify.log).toContain('play:Q2@0');
  });

  it('a block skip back to the slot start plays the queue from its first track', async () => {
    make({ cues: [queued] }).start();
    await runAt(250);
    await runAt(100);
    await advance(1500);
    expect(spotify.log.filter((l) => l.startsWith('play:'))).toEqual(['play:Q2@30', 'play:Q1@0']);
  });

  it('pause and resume keep the queued track in place', async () => {
    make({ cues: [queued] }).start();
    await runAt(250);
    engine.set({ status: 'paused' });
    await settle();
    engine.set({ status: 'running' });
    await settle();
    expect(spotify.log).toEqual(['play:Q2@30', 'pause', 'resume']);
  });

  it('fades the last track out when the slot ends (the next block has no music of its own)', async () => {
    make({ cues: [queued], silenceLastSec: 0 }).start();
    await runAt(299);
    expect(spotify.log).toEqual(['play:Q2@79']);
    engine.set({ status: 'finished', workoutElapsedSec: 600 });
    engine.emit({ type: 'segmentChanged', from: 1, to: 2, skipped: false });
    await advance(1500);
    expect(spotify.log.some((l) => l.startsWith('fadeOut'))).toBe(true);
  });
});

describe('music director: chain of recordings', () => {
  const yt = (id: string, startAtSec = 0): TrackRef => ({
    provider: 'youtube',
    id,
    title: `Title ${id}`,
    startAtSec,
  });
  const chained = (): MusicCue => ({
    blockId: 'b',
    rep: 1,
    track: { ...yt('Y1', 5), alternates: [yt('Y2', 20), yt('Y3', 0)] },
  });

  it('plays the main recording and keeps the others for later', async () => {
    const events: string[] = [];
    make({
      cues: [chained()],
      onCandidate: (e) => events.push(`${e.outcome}:${e.track.id}:${e.index}`),
    }).start();
    await runAt(130);
    expect(youtube.log).toEqual(['play:Y1@35']);
    expect(events).toEqual(['played:Y1:0']);
    expect(warnings).toEqual([]);
  });

  it('moves to the next recording at once, at the same place of the song', async () => {
    youtube.failPlaysWhen((t) => t.id === 'Y1');
    const events: string[] = [];
    make({
      cues: [chained()],
      onCandidate: (e) => events.push(`${e.outcome}:${e.track.id}`),
    }).start();
    await runAt(130); // 30 s into the song; Y2 has its own start 20 s
    expect(youtube.log).toEqual(['play:Y1@35', 'play:Y2@50']);
    expect(events).toEqual(['failed:Y1', 'played:Y2']);
    expect(warnings).toEqual([]);
  });

  it('goes through every recording and then stays silent with one warning', async () => {
    youtube.failPlaysWhen(() => true);
    make({ cues: [chained()] }).start();
    await runAt(130);
    expect(youtube.log).toEqual(['play:Y1@35', 'play:Y2@50', 'play:Y3@30']);
    expect(warnings).toHaveLength(1);
    // The workout goes on: later polls do not hammer the player.
    await advance(1000);
    expect(youtube.log).toHaveLength(3);
  });

  it('retries the whole chain once after the retry delay', async () => {
    youtube.failPlaysWhen(() => true);
    make({ cues: [chained()], retryMs: 3000 }).start();
    await runAt(130);
    youtube.failPlaysWhen(undefined);
    await advance(3000);
    expect(youtube.log.slice(-1)).toEqual(['play:Y1@35']);
  });

  it('a recording that stalls or errors while playing hands over to the next one', async () => {
    make({ cues: [chained()] }).start();
    await runAt(130);
    youtube.breakDown(new Error('stalled'));
    await advance(200);
    expect(youtube.log.filter((l) => l.startsWith('play:'))).toEqual(['play:Y1@35', 'play:Y2@50']);
  });

  it('falls back to Spotify when the YouTube recordings are dead', async () => {
    youtube.failPlaysWhen(() => true);
    const sp = { ...track('S1'), startAtSec: 0 };
    make({
      cues: [{ blockId: 'b', rep: 1, track: { ...yt('Y1'), alternates: [yt('Y2'), sp] } }],
    }).start();
    await runAt(100);
    expect(spotify.log).toEqual(['play:S1@0']);
    expect(warnings).toEqual([]);
  });

  it('puts recordings known to be unplayable last', async () => {
    make({
      cues: [
        {
          blockId: 'b',
          rep: 1,
          track: { ...yt('Y1'), notEmbeddable: true, alternates: [yt('Y2')] },
        },
      ],
    }).start();
    await runAt(100);
    expect(youtube.log).toEqual(['play:Y2@0']);
  });
});

describe('music director: failure memory and recordings of other lengths', () => {
  const yt = (id: string, startAtSec = 0, durationSec?: number): TrackRef => ({
    provider: 'youtube',
    id,
    title: `Title ${id}`,
    startAtSec,
    ...(durationSec !== undefined ? { durationSec } : {}),
  });
  const cueOf = (t: TrackRef): MusicCue => ({ blockId: 'b', rep: 1, track: t });
  const plays = () => youtube.log.filter((l) => l.startsWith('play:'));

  it('does not go back to a recording that already failed when a later one breaks', async () => {
    youtube.failPlaysWhen((t) => t.id === 'Y1');
    make({ cues: [cueOf({ ...yt('Y1'), alternates: [yt('Y2'), yt('Y3')] })] }).start();
    await runAt(130);
    expect(plays()).toEqual(['play:Y1@30', 'play:Y2@30']);
    youtube.breakDown();
    await advance(200);
    expect(plays()).toEqual(['play:Y1@30', 'play:Y2@30', 'play:Y3@30']);
  });

  it('skips a recording that ends before the position at once (no stalled seek)', async () => {
    make({
      cues: [cueOf({ ...yt('V', 0, 400), alternates: [yt('SHORT', 0, 100), yt('LONG', 0, 400)] })],
    }).start();
    await runAt(330); // 230 s into the song: SHORT (100 s) cannot reach it
    expect(plays()).toEqual(['play:V@230']);
    youtube.breakDown();
    await advance(200);
    expect(plays()).toEqual(['play:V@230', 'play:LONG@230']);
  });

  it('tries a recording shorter than the planned song only after the full-length ones', async () => {
    make({
      cues: [
        cueOf({ ...yt('MAIN', 0, 400), alternates: [yt('VIDEO', 0, 200), yt('FULL', 0, 400)] }),
      ],
    }).start();
    await runAt(110);
    youtube.failPlaysWhen((t) => t.id === 'FULL');
    youtube.breakDown(); // MAIN broke: FULL is next (fails), then the shorter VIDEO
    await advance(200);
    expect(plays()).toEqual(['play:MAIN@10', 'play:FULL@10', 'play:VIDEO@10']);
  });

  it('stays silent, without a warning, when no recording reaches the position', async () => {
    make({ cues: [cueOf({ ...yt('A', 0, 50), alternates: [yt('B', 0, 60)] })] }).start();
    await runAt(300);
    expect(youtube.log).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
