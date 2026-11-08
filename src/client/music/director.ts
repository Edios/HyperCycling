import { musicAt, nextTrackChange, type ScheduledTrack } from '../../domain/music-schedule';
import type { EngineEvent, EngineState } from '../../domain/session-engine';
import type { Segment } from '../../domain/segments';
import type { MusicCue, TrackRef } from '../../domain/workout';
import type { MusicProvider, TrackInfo } from './types';

export const FADE_OUT_MS = 1500;
/** Fade used between two songs in a session: short, so the gap stays well under a second. */
export const SWITCH_FADE_MS = 300;
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
  /**
   * Told about every recording the director tried: which one of a song's chain it was, and
   * whether it played or failed (for the diagnostics log).
   */
  onCandidate?(event: CandidateEvent): void;
  /** Volume 0..1 applied to every provider; 1 by default. */
  volume?: number;
  /** Music fades out and stays off for this many seconds before the workout ends (0 = off). */
  silenceLastSec?: number;
  fadeMs?: number;
  /**
   * Fade length when one track is replaced by another (a cue cut or a seek). Shorter than `fadeMs`
   * keeps the silence between songs small; defaults to `fadeMs`.
   */
  switchFadeMs?: number;
  retryMs?: number;
  pollMs?: number;
}

export interface CandidateEvent {
  /** The recording tried (without its backups). */
  track: TrackRef;
  /** Place in the song's chain, 0 = the main recording. */
  index: number;
  total: number;
  outcome: 'played' | 'failed';
  error?: unknown;
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
  /** Which recording of the song's chain plays (0 = the main one). */
  index: number;
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
  const switchFadeMs = options.switchFadeMs ?? fadeMs;
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
  /** Per scheduled track: the chain positions that failed (in the current attempt). */
  const failedCandidates = new Map<string, Set<number>>();
  /** Id of the newest `play` issued to each provider; older completions are stale. */
  const latestPlay = new Map<MusicProvider, number>();
  let playCounter = 0;
  let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();

  const silenceFromSec = (() => {
    const quiet = options.silenceLastSec ?? 0;
    if (!(quiet > 0)) return Infinity;
    let total = 0;
    for (const s of options.segments) total = Math.max(total, s.startSec + s.durationSec);
    return total - quiet;
  })();

  const desiredNow = (state: EngineState): ScheduledTrack | null =>
    state.status === 'running' && state.workoutElapsedSec < silenceFromSec
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
      failedCandidates.delete(key);
      void reconcile();
    }, retryMs);
    retryTimers.add(timer);
  }

  const chainOf = (track: TrackRef): TrackRef[] => {
    const { alternates, ...main } = track;
    const all = [main, ...(alternates ?? [])];
    // Recordings known to be unplayable go last, but are kept: the check may have been wrong.
    const ok = all.filter((t) => !t.notEmbeddable);
    return [...ok, ...all.filter((t) => t.notEmbeddable)];
  };

  const emit = (event: CandidateEvent): void => {
    try {
      options.onCandidate?.(event);
    } catch (err) {
      console.error('Music candidate handler failed', err);
    }
  };

  /**
   * Plays one recording of the chain. Returns undefined on success, else the failure. Only a
   * rejection of this recording counts: a connect that outlasts the schedule ends the attempt.
   */
  async function tryCandidate(
    desired: ScheduledTrack,
    cand: TrackRef,
  ): Promise<{ stale: true } | { error: unknown } | { provider: MusicProvider }> {
    const provider = options.getProvider(cand.provider);
    try {
      if (!provider) throw new Error(`No ${cand.provider} music provider available`);
      if (!provider.isReady()) {
        await bounded(() => provider.connect(), CONNECT_TIMEOUT_MS, 'connect');
        if (disposed) return { stale: true };
        // Connecting can take a while; the engine has moved on.
        if (desiredNow(options.getState())?.key !== desired.key) return { stale: true };
      }
      // The same place of the song in this recording, whatever time the failures took.
      const fresh = desiredNow(options.getState());
      if (fresh?.key !== desired.key) return { stale: true };
      const offsetSec = Math.max(0, cand.startAtSec + (fresh.offsetSec - desired.track.startAtSec));
      // A muted session must not start audible: set the level before the track begins.
      if (volume !== 1) await quietly('volume', () => provider.setVolume(volume));
      const playId = ++playCounter;
      latestPlay.set(provider, playId);
      await bounded(
        () => provider.play(cand, offsetSec),
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
      return { provider };
    } catch (err) {
      return { error: err };
    }
  }

  /**
   * Starts the desired track: the main recording, and when it fails the next one of its chain,
   * at once and at the same place of the song. Returns true when the loop should look again.
   */
  async function startTrack(desired: ScheduledTrack): Promise<boolean> {
    const record = failures.get(desired.key);
    if (record && !(record.count === 1 && record.retryReady)) return false; // waiting or given up
    if (disposed) return false;
    const chain = chainOf(desired.track);
    const skip = failedCandidates.get(desired.key) ?? new Set<number>();
    failedCandidates.set(desired.key, skip);
    let lastError: unknown;
    for (let index = 0; index < chain.length; index++) {
      if (skip.has(index)) continue;
      const cand = chain[index] as TrackRef;
      const result = await tryCandidate(desired, cand);
      if ('stale' in result) return !disposed;
      if ('error' in result) {
        if (disposed) return false;
        skip.add(index);
        lastError = result.error;
        console.warn('Music recording could not be played', result.error);
        emit({ track: cand, index, total: chain.length, outcome: 'failed', error: result.error });
        continue;
      }
      const { provider } = result;
      failures.delete(desired.key);
      failedCandidates.delete(desired.key);
      if (disposed) {
        void quietly('pause', () => provider.pause());
        return false;
      }
      const playing: Playing = {
        key: desired.key,
        track: cand,
        index,
        provider,
        halted: false,
      };
      current = playing;
      provider.setFailureHandler?.((err) => onPlaybackFailure(playing, err));
      emit({ track: cand, index, total: chain.length, outcome: 'played' });
      announce(cand);
      if (!cand.title) void resolveTitle(playing);
      return true;
    }
    // Every recording failed: one warning and one retry, then silence. The workout goes on.
    failedCandidates.delete(desired.key);
    recordFailure(desired.track, desired.key, lastError);
    return false;
  }

  /** A recording that was playing broke down (player error, stalled): move on along the chain. */
  function onPlaybackFailure(playing: Playing, err: unknown): void {
    if (disposed || current !== playing) return;
    console.warn('Music recording failed while playing', err);
    emit({ track: playing.track, index: playing.index, total: 0, outcome: 'failed', error: err });
    const skip = failedCandidates.get(playing.key) ?? new Set<number>();
    skip.add(playing.index);
    failedCandidates.set(playing.key, skip);
    current = null;
    announce(null);
    void quietly('pause', () => playing.provider.pause());
    void reconcile();
  }

  /**
   * A track saved without a title gets its name from the provider, in the background: playback
   * never waits for it, a failure is only logged, and a name that arrives after the track
   * changed is dropped.
   */
  async function resolveTitle(playing: Playing): Promise<void> {
    const describe = playing.provider.describeTrack?.bind(playing.provider);
    if (!describe) return;
    let info: TrackInfo | undefined;
    try {
      await bounded(
        async () => {
          info = await describe(playing.track);
        },
        CONTROL_TIMEOUT_MS,
        'describe',
      );
    } catch (err) {
      console.warn('Music track name lookup failed', err);
      return;
    }
    if (disposed || current !== playing || !info?.title) return;
    announce({
      ...playing.track,
      title: info.title,
      ...(info.artist && !playing.track.artist ? { artist: info.artist } : {}),
    });
  }

  function announce(track: TrackRef | null): void {
    try {
      options.onPlaying?.(track);
    } catch (err) {
      console.error('Music now-playing handler failed', err);
    }
  }

  const fade = (playing: Playing, ms: number = fadeMs): Promise<void> =>
    quietly('fade out', () => playing.provider.fadeOut(ms), ms + FADE_SLACK_MS);

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
      if (!playing.halted) await fade(playing, switchFadeMs);
      return true;
    }

    return startTrack(desired);
  }

  /**
   * Wakes the loop right when the schedule changes track (the next song of a slot's queue), so the
   * switch does not wait for the next poll. Only a timer: the decision stays in `step`.
   */
  function armBoundary(): void {
    if (boundaryTimer !== undefined) clearTimeout(boundaryTimer);
    boundaryTimer = undefined;
    const state = options.getState();
    if (disposed || state.status !== 'running') return;
    const next = nextTrackChange({
      segments: options.segments,
      cues: options.cues,
      fallback: options.fallback,
      tSec: state.workoutElapsedSec,
    });
    if (!next) return;
    const ms = Math.max(0, (next.atSec - state.workoutElapsedSec) * 1000);
    if (ms > pollMs) return; // the regular poll gets there first or close enough
    boundaryTimer = setTimeout(() => {
      boundaryTimer = undefined;
      void reconcile();
    }, ms);
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
      armBoundary();
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
      if (boundaryTimer !== undefined) clearTimeout(boundaryTimer);
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      const playing = current;
      current = null;
      if (playing && !playing.halted) void quietly('pause', () => playing.provider.pause());
    },
  };
}
