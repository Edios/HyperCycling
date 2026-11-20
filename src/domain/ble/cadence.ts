/**
 * Cadence from cumulative crank revolution data (CSC or Cycling Power). Both counters are uint16:
 * revolutions wrap at 65536 and the event time (1/1024 s) wraps every 64 s.
 */

export interface CrankSample {
  revs: number;
  eventTime1024: number;
}

export interface CadenceTracker {
  /** Feeds one measurement received at `receivedAtMs`; returns the cadence at that moment. */
  push(sample: CrankSample, receivedAtMs: number): number;
  /** Cadence at `nowMs`: 0 once no new revolution arrived for `staleMs`. */
  rpm(nowMs: number): number;
  reset(): void;
}

export interface CadenceTrackerOptions {
  /** No new revolution for this long means the crank stopped. */
  staleMs?: number;
  /** Values above this are treated as sensor glitches and dropped. */
  maxRpm?: number;
}

const WRAP = 0x10000;

/**
 * Difference between two readings of a wrapping counter (uint16: 2 ** 16, uint32: 2 ** 32),
 * assuming it wrapped at most once.
 */
export function counterDelta(current: number, previous: number, modulo: number): number {
  return (((current - previous) % modulo) + modulo) % modulo;
}

export function createCadenceTracker({
  staleMs = 3000,
  maxRpm = 250,
}: CadenceTrackerOptions = {}): CadenceTracker {
  let prev: CrankSample | null = null;
  let current = 0;
  let lastRevAtMs: number | null = null;

  const rpm = (nowMs: number): number =>
    lastRevAtMs === null || nowMs - lastRevAtMs > staleMs ? 0 : current;

  return {
    push(sample, receivedAtMs) {
      const last = prev;
      if (last === null) {
        prev = sample;
        return rpm(receivedAtMs);
      }
      const dRev = counterDelta(sample.revs, last.revs, WRAP);
      const dTime = counterDelta(sample.eventTime1024, last.eventTime1024, WRAP);
      // dT = 0: the sensor repeats its last event (crank stopped or duplicate); nothing new.
      if (dTime === 0 || dRev === 0) return rpm(receivedAtMs);
      prev = sample;
      const value = (dRev * 60 * 1024) / dTime;
      if (value > maxRpm) return rpm(receivedAtMs);
      current = value;
      lastRevAtMs = receivedAtMs;
      return current;
    },
    rpm,
    reset() {
      prev = null;
      current = 0;
      lastRevAtMs = null;
    },
  };
}
