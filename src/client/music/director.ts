import { musicAt, type ScheduledTrack } from '../../domain/music-schedule';
import type { EngineEvent, EngineState } from '../../domain/session-engine';
import type { Segment } from '../../domain/segments';
import type { MusicCue, TrackRef } from '../../domain/workout';
import type { MusicProvider } from './types';

export const FADE_OUT_MS = 1500;
export const RETRY_DELAY_MS = 3000;
export const POLL_MS = 1000;
/** A provider call that has not settled by then counts as a rejection. */
export const CONNECT_TIMEOUT_MS = 10_000;
export const PLAY_TIMEOUT_MS = 10_000;
/** Pause and resume are quick; a fade gets its own length plus this slack. */
export const CONTROL_TIMEOUT_MS = 5_000;
export const FADE_SLACK_MS = 2_000;

export interface MusicDirectorOptions {
  segments: Segment[];
  cues: MusicCue[];
  fallback: TrackRef[];
  /** Provider for a track's service; `undefined` means it is not available (counts as a failure). */
  getProvider(kind: TrackRef['provider']): MusicProvider | undefined;
  /** Read-only view of the engine. The director never drives it. */
  getState(): EngineState;
  subscribeEvents(cb: (event: EngineEvent, state: EngineState) => void): () => void;
  /** Called on every state change; the director reacts only when the status changes. */
  subscribeState(cb: () => void): () => void;
  /** Called once per track that cannot be played (not for the retry), with the failure. */
  onWarning(track: TrackRef, error?: unknown): void;
  /** The track now playing (or paused), `null` once nothing is scheduled. */
  onPlaying?(track: TrackRef | null): void;
  /** Volume 0..1 applied to every provider; 1 by default. */
  volume?: number;
  fadeMs?: number;
  retryMs?: number;
  pollMs?: number;
}

export interface MusicDirector {
  /** Mute/unmute: 0..1. Applies to the current track and to those that follow. */
  setVolume(v: number): void;
  start(): void;
  dispose(): void;
}

interface Playing {
  key: string;
  track: TrackRef;
  provider: MusicProvider;
  /** Paused because the engine is not running; resumed when it runs again on the same track. */
  halted: boolean;
}

interface FailureRecord {
  count: number;
  retryReady: boolean;
}

/**
 * Runs `call` but gives up on waiting after `ms`: the returned promise then rejects. If the
 * call settles successfully after that, `onLateSuccess` is told (its result is stale by then).
 */
function bounded(
  call: () => Promise<void>,
  ms: number,
  label: string,
  onLateSuccess?: () => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timedOut = false;
    let done = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Music provider ${label} timed out after ${ms} ms`));
    }, ms);
    let pending: Promise<void>;
    try {
      pending = call();
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }
    pending.then(
      () => {
        if (timedOut) {
          onLateSuccess?.();
          return;
        }
        done = true;
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        if (timedOut || done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Keeps the music in step with the workout: desired track = `musicAt(elapsed)`. A changed key
 * fades the old track out (1.5 s) and then starts the new one at its current offset. Pause and
 * resume follow the engine; a seek is just a state change that the same reconcile loop picks up.
 *
 * It only reads the engine. Whatever a provider does (or fails to do), the workout is untouched.
 * Every provider call is bounded by a timeout, so a call that never settles cannot wedge the
 * director: it is treated like a rejection.
 */
export function createMusicDirector(options: MusicDirectorOptions): MusicDirector {
  const fadeMs = options.fadeMs ?? FADE_OUT_MS;
  const retryMs = options.retryMs ?? RETRY_DELAY_MS;
  const pollMs = options.pollMs ?? POLL_MS;

  let current: Playing | null = null;
  let volume = options.volume ?? 1;
  let disposed = false;
  let started = false;
  let running = false;
  let dirty = false;
  let lastStatus: EngineState['status'] | undefined;
  let unsubscribeEvents: (() => void) | undefined;
  let unsubscribeState: (() => void) | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  const failures = new Map<string, FailureRecord>();
  /** Id of the newest `play` issued to each provider; older completions are stale. */
  const latestPlay = new Map<MusicProvider, number>();
  let playCounter = 0;
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();

  const desiredNow = (state: EngineState): ScheduledTrack | null =>
    state.status === 'running'
      ? musicAt({
          segments: options.segments,
          cues: options.cues,
          fallback: options.fallback,
          tSec: state.workoutElapsedSec,
        })
      : null;

  /** Provider calls whose failure matters little (fade, pause): log and carry on. */
  async function quietly(
    label: string,
    call: () => Promise<void>,
    timeoutMs: number = CONTROL_TIMEOUT_MS,
  ): Promise<void> {
    try {
      await bounded(call, timeoutMs, label);
    } catch (err) {
      console.warn(`Music ${label} failed`, err);
    }
  }

  function recordFailure(track: TrackRef, key: string, err: unknown): void {
    if (disposed) return; // a failure caused by tearing down is not worth a warning
    console.warn('Music track could not be played', err);
    const record = failures.get(key) ?? { count: 0, retryReady: false };
    record.count += 1;
    failures.set(key, record);
    if (record.count !== 1) return; // one warning and one retry per scheduled track
    try {
      options.onWarning(track, err);
    } catch (warnErr) {
      console.error('Music warning handler failed', warnErr);
    }
    const timer = setTimeout(() => {
      retryTimers.delete(timer);
      record.retryReady = true;
      void reconcile();
    }, retryMs);
    retryTimers.add(timer);
  }

  /** Starts the desired track. Returns true when the loop should look again. */
  async function startTrack(desired: ScheduledTrack): Promise<boolean> {
    const record = failures.get(desired.key);
    if (record && !(record.count === 1 && record.retryReady)) return false; // waiting or given up
    if (disposed) return false;
    let offsetSec = desired.offsetSec;
    const provider = options.getProvider(desired.track.provider);
    try {
      if (!provider) throw new Error(`No ${desired.track.provider} music provider available`);
      if (!provider.isReady()) {
        await bounded(() => provider.connect(), CONNECT_TIMEOUT_MS, 'connect');
        if (disposed) return false;
        // Connecting can take a while; the engine has moved on.
        const fresh = desiredNow(options.getState());
        if (fresh?.key !== desired.key) return true; // the loop will decide again
        offsetSec = fresh.offsetSec;
      }
      // A muted session must not start audible: set the level before the track begins.
      if (volume !== 1) await quietly('volume', () => provider.setVolume(volume));
      const playId = ++playCounter;
      latestPlay.set(provider, playId);
      await bounded(
        () => provider.play(desired.track, offsetSec),
        PLAY_TIMEOUT_MS,
        'play',
        // The timed-out play started after all. Silence it, unless a newer play has taken over
        // that provider or the track is now the one we track as playing.
        () => {
          if (latestPlay.get(provider) === playId && current?.provider !== provider) {
            void quietly('pause', () => provider.pause());
          }
        },
      );
    } catch (err) {
      recordFailure(desired.track, desired.key, err);
      return false;
    }
    failures.delete(desired.key);
    if (disposed) {
      void quietly('pause', () => provider.pause());
      return false;
    }
    current = { key: desired.key, track: desired.track, provider, halted: false };
    announce(desired.track);
    return true;
  }

  function announce(track: TrackRef | null): void {
    try {
      options.onPlaying?.(track);
    } catch (err) {
      console.error('Music now-playing handler failed', err);
    }
  }

  const fade = (playing: Playing): Promise<void> =>
    quietly('fade out', () => playing.provider.fadeOut(fadeMs), fadeMs + FADE_SLACK_MS);

  /** One decision. Returns true when it did something, so the loop looks again. */
  async function step(): Promise<boolean> {
    const state = options.getState();

    if (state.status !== 'running' && state.status !== 'finished') {
      const playing = current;
      if (!playing || playing.halted) return false;
      playing.halted = true;
      await quietly('pause', () => playing.provider.pause());
      return true;
    }

    const desired = desiredNow(state);
    if (!desired) {
      const playing = current;
      if (!playing) return false;
      current = null;
      announce(null);
      if (!playing.halted) await fade(playing);
      return true;
    }

    if (current && current.key === desired.key) {
      const playing = current;
      if (!playing.halted) return false;
      playing.halted = false;
      try {
        await bounded(() => playing.provider.resume(), CONTROL_TIMEOUT_MS, 'resume');
      } catch (err) {
        console.warn('Music resume failed', err);
        if (current === playing) current = null; // start the track again from the right offset
      }
      return true;
    }

    if (current) {
      // The old track fades out first; the new one then starts from a fresh offset.
      const playing = current;
      current = null;
      announce(null);
      if (!playing.halted) await fade(playing);
      return true;
    }

    return startTrack(desired);
  }

  async function reconcile(): Promise<void> {
    if (disposed || !started) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      let again = true;
      while (again && !disposed) {
        dirty = false;
        try {
          again = (await step()) || dirty;
        } catch (err) {
          console.error('Music director step failed', err);
          again = dirty; // a trigger that arrived meanwhile must not wait for the next poll
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    setVolume(v) {
      const next = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
      if (next === volume) return;
      volume = next;
      const playing = current;
      if (playing && !disposed) {
        void quietly('volume', () => playing.provider.setVolume(volume));
      }
    },

    start() {
      if (started || disposed) return;
      if (options.cues.length === 0 && options.fallback.length === 0) return; // nothing to play
      started = true;
      lastStatus = options.getState().status;
      unsubscribeEvents = options.subscribeEvents(() => void reconcile());
      unsubscribeState = options.subscribeState(() => {
        const status = options.getState().status;
        if (status === lastStatus) return;
        lastStatus = status;
        void reconcile();
      });
      poll = setInterval(() => void reconcile(), pollMs);
      void reconcile();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeEvents?.();
      unsubscribeState?.();
      if (poll !== undefined) clearInterval(poll);
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      const playing = current;
      current = null;
      if (playing && !playing.halted) void quietly('pause', () => playing.provider.pause());
    },
  };
}
