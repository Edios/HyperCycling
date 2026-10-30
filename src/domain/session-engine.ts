import { segmentAt, type Segment } from './segments';

export type EngineStatus = 'idle' | 'countdown' | 'running' | 'paused' | 'finished';

export interface EngineState {
  status: EngineStatus;
  segmentIndex: number;
  workoutElapsedSec: number;
  segmentElapsedSec: number;
  segmentRemainingSec: number;
  /** 3,2,1 while status === 'countdown'. */
  startCountdown?: number;
}

export type EngineEvent =
  /** skipped = true when caused by next/prev/seek or a long gap. */
  | { type: 'segmentChanged'; from: number; to: number; skipped: boolean }
  | { type: 'countdownTick'; n: 3 | 2 | 1; phase: 'start' | 'segmentEnd' }
  | { type: 'finished' };

export interface EngineSnapshot {
  segmentIndex: number;
  workoutElapsedSec: number;
  status: 'paused' | 'running';
}

export interface SessionEngine {
  start(): void;
  pause(): void;
  resume(): void;
  next(): void;
  prev(): void;
  seek(segmentIndex: number): void;
  /** Call every animation frame; returns events since the previous tick. */
  tick(): EngineEvent[];
  getState(): EngineState;
  snapshot(): EngineSnapshot;
}

export interface SessionEngineOptions {
  /** Default 3. */
  startCountdownSec?: number;
  /** Default 2. A longer silence between ticks is applied without beeps. */
  gapThresholdSec?: number;
}

const COUNTDOWN_NS = [3, 2, 1] as const;

function isCountdownN(n: number): n is 3 | 2 | 1 {
  return n === 3 || n === 2 || n === 1;
}

/**
 * Time model: workout time is the sum of intervals during which the engine was running, measured
 * with the injected clock (integer milliseconds internally). Countdown and pause add nothing.
 */
function build(
  segments: Segment[],
  nowMs: () => number,
  opts: SessionEngineOptions,
  initialElapsedMs: number | null,
): SessionEngine {
  if (segments.length === 0) throw new Error('Session engine needs at least one segment');

  const last = segments.length - 1;
  const countdownSec = opts.startCountdownSec ?? 3;
  const countdownMs = countdownSec * 1000;
  const gapMs = (opts.gapThresholdSec ?? 2) * 1000;
  const startMsOf = segments.map((s) => Math.round(s.startSec * 1000));
  const endMsOf = segments.map((s) => Math.round((s.startSec + s.durationSec) * 1000));
  const totalMs = endMsOf[last] ?? 0;

  let status: EngineStatus = initialElapsedMs === null ? 'idle' : 'paused';
  /** Workout ms accumulated before `runStart`. */
  let accMs = initialElapsedMs === null ? 0 : Math.min(Math.max(initialElapsedMs, 0), totalMs);
  /** Clock value at which the current running interval began (null unless running). */
  let runStart: number | null = null;
  let countdownStart = 0;
  let lastCountdownN: number | null = null;
  let lastTickNow = 0;
  let lastIndex = indexAtMs(accMs);
  let jumped = false;
  let finishPending = false;
  let endTrackIndex = -1;
  const endEmitted = new Set<number>();

  function indexAtMs(ms: number): number {
    return Math.max(0, segmentAt(segments, ms / 1000));
  }

  function elapsedMsAt(now: number): number {
    const live = runStart === null ? accMs : accMs + (now - runStart);
    return Math.min(Math.max(live, 0), totalMs);
  }

  /** Marks segmentEnd ticks that cannot be heard any more for a given remaining time. */
  function markPassed(remainingMs: number): void {
    for (const n of COUNTDOWN_NS) if (n * 1000 >= remainingMs) endEmitted.add(n);
  }

  function resetEndTracking(index: number, elapsedMs: number): void {
    endTrackIndex = index;
    endEmitted.clear();
    markPassed((endMsOf[index] ?? 0) - elapsedMs);
  }

  function jumpTo(index: number): void {
    const target = Math.min(Math.max(index, 0), last);
    accMs = startMsOf[target] ?? 0;
    if (runStart !== null) runStart = nowMs();
    jumped = true;
    resetEndTracking(target, accMs);
  }

  function finishNow(): void {
    status = 'finished';
    accMs = totalMs;
    runStart = null;
    finishPending = true;
  }

  const isActive = (): boolean => status === 'running' || status === 'paused';

  function currentIndex(now: number): number {
    return indexAtMs(elapsedMsAt(now));
  }

  return {
    start() {
      if (status !== 'idle') return;
      const now = nowMs();
      status = 'countdown';
      countdownStart = now;
      lastCountdownN = null;
      lastTickNow = now;
    },

    pause() {
      if (status !== 'running' || runStart === null) return;
      accMs = elapsedMsAt(nowMs());
      runStart = null;
      status = 'paused';
    },

    resume() {
      if (status !== 'paused') return;
      const now = nowMs();
      runStart = now;
      lastTickNow = now;
      status = 'running';
    },

    next() {
      if (!isActive()) return;
      const idx = currentIndex(nowMs());
      if (idx >= last) finishNow();
      else jumpTo(idx + 1);
    },

    prev() {
      if (!isActive()) return;
      const now = nowMs();
      const elapsed = elapsedMsAt(now);
      const idx = indexAtMs(elapsed);
      const intoSegment = elapsed - (startMsOf[idx] ?? 0);
      jumpTo(intoSegment > 3000 ? idx : Math.max(idx - 1, 0));
    },

    seek(segmentIndex) {
      if (!isActive()) return;
      jumpTo(segmentIndex);
    },

    tick() {
      if (status === 'idle' || (status === 'finished' && !finishPending)) return [];
      const now = nowMs();
      const events: EngineEvent[] = [];
      const gap = (status === 'running' || status === 'countdown') && now - lastTickNow > gapMs;
      lastTickNow = now;

      if (status === 'countdown') {
        const into = now - countdownStart;
        if (into < countdownMs) {
          const n = countdownSec - Math.floor(into / 1000);
          if (n !== lastCountdownN) {
            lastCountdownN = n;
            if (isCountdownN(n)) events.push({ type: 'countdownTick', n, phase: 'start' });
          }
          return events;
        }
        status = 'running';
        accMs = 0;
        runStart = countdownStart + countdownMs;
        resetEndTracking(0, 0);
      }

      const elapsed = elapsedMsAt(now);
      const idx = indexAtMs(elapsed);
      const changed = idx !== lastIndex;

      if (status === 'running' && elapsed >= totalMs) finishNow();

      if (status === 'running' && !gap && !changed && idx < last) {
        if (endTrackIndex !== idx) resetEndTracking(idx, elapsed);
        const remaining = (endMsOf[idx] ?? 0) - elapsed;
        for (const n of COUNTDOWN_NS) {
          if (remaining <= n * 1000 && remaining > (n - 1) * 1000 && !endEmitted.has(n)) {
            endEmitted.add(n);
            events.push({ type: 'countdownTick', n, phase: 'segmentEnd' });
          }
        }
      } else if (changed || gap) {
        // Silent catch-up: no beeps for the skipped span.
        resetEndTracking(idx, elapsed);
      }

      if (changed) {
        events.push({ type: 'segmentChanged', from: lastIndex, to: idx, skipped: jumped || gap });
        lastIndex = idx;
      }
      jumped = false;

      if (finishPending) {
        finishPending = false;
        events.push({ type: 'finished' });
      }
      return events;
    },

    getState() {
      const now = nowMs();
      if (status === 'idle' || status === 'countdown') {
        const first = segments[0];
        const state: EngineState = {
          status,
          segmentIndex: 0,
          workoutElapsedSec: 0,
          segmentElapsedSec: 0,
          segmentRemainingSec: first ? first.durationSec : 0,
        };
        if (status === 'countdown') {
          const n = countdownSec - Math.floor(Math.max(now - countdownStart, 0) / 1000);
          state.startCountdown = Math.min(Math.max(n, 1), countdownSec);
        }
        return state;
      }
      const elapsed = elapsedMsAt(now);
      const idx = indexAtMs(elapsed);
      const segStart = startMsOf[idx] ?? 0;
      const segEnd = endMsOf[idx] ?? 0;
      return {
        status,
        segmentIndex: idx,
        workoutElapsedSec: elapsed / 1000,
        segmentElapsedSec: (elapsed - segStart) / 1000,
        segmentRemainingSec: (segEnd - elapsed) / 1000,
      };
    },

    snapshot() {
      const now = nowMs();
      const elapsed = status === 'idle' || status === 'countdown' ? 0 : elapsedMsAt(now);
      return {
        segmentIndex: indexAtMs(elapsed),
        workoutElapsedSec: elapsed / 1000,
        status: status === 'running' ? 'running' : 'paused',
      };
    },
  };
}

export function createSessionEngine(
  segments: Segment[],
  nowMs: () => number,
  opts: SessionEngineOptions = {},
): SessionEngine {
  return build(segments, nowMs, opts, null);
}

/** Always restores as 'paused'; the segment is derived from time, `snap.segmentIndex` is ignored. */
export function restoreSessionEngine(
  segments: Segment[],
  nowMs: () => number,
  snap: EngineSnapshot,
): SessionEngine {
  return build(segments, nowMs, {}, Math.round(snap.workoutElapsedSec * 1000));
}
