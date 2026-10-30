import { musicAt, type ScheduledTrack } from '../../domain/music-schedule';
import type { EngineEvent, EngineState } from '../../domain/session-engine';
import type { Segment } from '../../domain/segments';
import type { MusicCue, TrackRef } from '../../domain/workout';
import type { MusicProvider } from './types';

export const FADE_OUT_MS = 1500;
export const RETRY_DELAY_MS = 3000;
export const POLL_MS = 1000;

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
  /** Called once per track that cannot be played (not for the retry). */
  onWarning(track: TrackRef): void;
  fadeMs?: number;
  retryMs?: number;
  pollMs?: number;
}

export interface MusicDirector {
  start(): void;
  dispose(): void;
}

interface Playing {
  key: string;
  provider: MusicProvider;
  /** Paused because the engine is not running; resumed when it runs again on the same track. */
  halted: boolean;
}

interface FailureRecord {
  count: number;
  retryReady: boolean;
}

/**
 * Keeps the music in step with the workout: desired track = `musicAt(elapsed)`. A changed key
 * fades the old track out (1.5 s) and then starts the new one at its current offset. Pause and
 * resume follow the engine; a seek is just a state change that the same reconcile loop picks up.
 *
 * It only reads the engine. Whatever a provider does (or fails to do), the workout is untouched.
 */
export function createMusicDirector(options: MusicDirectorOptions): MusicDirector {
  const fadeMs = options.fadeMs ?? FADE_OUT_MS;
  const retryMs = options.retryMs ?? RETRY_DELAY_MS;
  const pollMs = options.pollMs ?? POLL_MS;

  let current: Playing | null = null;
  let disposed = false;
  let started = false;
  let running = false;
  let dirty = false;
  let lastStatus: EngineState['status'] | undefined;
  let unsubscribeEvents: (() => void) | undefined;
  let unsubscribeState: (() => void) | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  const failures = new Map<string, FailureRecord>();
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
  async function quietly(label: string, call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch (err) {
      console.warn(`Music ${label} failed`, err);
    }
  }

  function recordFailure(track: TrackRef, key: string, err: unknown): void {
    console.warn('Music track could not be played', err);
    const record = failures.get(key) ?? { count: 0, retryReady: false };
    record.count += 1;
    failures.set(key, record);
    if (record.count !== 1) return; // one warning and one retry per scheduled track
    try {
      options.onWarning(track);
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
    let offsetSec = desired.offsetSec;
    const provider = options.getProvider(desired.track.provider);
    try {
      if (!provider) throw new Error(`No ${desired.track.provider} music provider available`);
      if (!provider.isReady()) {
        await provider.connect();
        // Connecting can take a while; the engine has moved on.
        const fresh = desiredNow(options.getState());
        if (fresh?.key !== desired.key) return true; // the loop will decide again
        offsetSec = fresh.offsetSec;
      }
      await provider.play(desired.track, offsetSec);
    } catch (err) {
      recordFailure(desired.track, desired.key, err);
      return false;
    }
    failures.delete(desired.key);
    if (disposed) {
      void quietly('pause', () => provider.pause());
      return false;
    }
    current = { key: desired.key, provider, halted: false };
    return true;
  }

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
      if (!playing.halted) await quietly('fade out', () => playing.provider.fadeOut(fadeMs));
      return true;
    }

    if (current && current.key === desired.key) {
      const playing = current;
      if (!playing.halted) return false;
      playing.halted = false;
      try {
        await playing.provider.resume();
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
      if (!playing.halted) await quietly('fade out', () => playing.provider.fadeOut(fadeMs));
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
          again = false;
        }
      }
    } finally {
      running = false;
    }
  }

  return {
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
