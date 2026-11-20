/**
 * Live sensor values for the HUD: a time-weighted rolling power average and simple judgements of
 * cadence against the block's target. Pure and allocation-free after construction (fixed ring
 * buffers), so it can run on every trainer notification.
 */

/**
 * HUD power is the average of the last 3 s, weighted by time (report 5.1). Each reading stands for
 * the time since the reading before it, and the newest one also holds until now, so a new value
 * shows at once instead of one notification late.
 */
export const POWER_WINDOW_MS = 3000;
/** No new reading for this long: the value is shown as missing, never as zero. */
export const STALE_MS = 3000;
/** Readings outside 0..2500 W are sensor glitches (report 5.1). */
export const MAX_VALID_WATTS = 2500;
/** Cadence within ± this many rpm of the target is "on target". */
export const CADENCE_TOLERANCE_RPM = 5;

export interface PowerSmoother {
  /** Adds a reading received at `atMs`; invalid values are ignored. */
  push(watts: number, atMs: number): void;
  /** Average over the window ending at `nowMs`, or null when there is no fresh reading. */
  value(nowMs: number): number | null;
  reset(): void;
}

export function createPowerSmoother({
  windowMs = POWER_WINDOW_MS,
  capacity = 64,
}: { windowMs?: number; capacity?: number } = {}): PowerSmoother {
  const times = new Float64Array(capacity);
  const watts = new Float64Array(capacity);
  let start = 0; // index of the oldest sample
  let count = 0;

  const at = (i: number) => (start + i) % capacity;

  return {
    push(w, atMs) {
      if (!Number.isFinite(w) || w < 0 || w > MAX_VALID_WATTS || !Number.isFinite(atMs)) return;
      if (count > 0 && atMs < (times[at(count - 1)] ?? 0)) return; // out of order
      if (count === capacity) {
        start = (start + 1) % capacity;
        count -= 1;
      }
      const i = at(count);
      times[i] = atMs;
      watts[i] = w;
      count += 1;
      // Drop samples that can no longer reach into any window (keep one before it to hold).
      while (count > 1 && (times[at(1)] ?? 0) <= atMs - windowMs) {
        start = (start + 1) % capacity;
        count -= 1;
      }
    },
    value(nowMs) {
      if (count === 0) return null;
      const last = at(count - 1);
      const lastT = times[last] ?? 0;
      const now = Math.max(nowMs, lastT);
      if (now - lastT > windowMs) return null;
      const from = now - windowMs;
      let area = 0;
      let span = 0;
      for (let k = 0; k < count; k++) {
        const t0 = Math.max(times[at(k === 0 ? 0 : k - 1)] ?? 0, from);
        const t1 = k === count - 1 ? now : (times[at(k)] ?? 0);
        if (t1 <= t0) continue;
        area += (watts[at(k)] ?? 0) * (t1 - t0);
        span += t1 - t0;
      }
      // A single reading received exactly now has no duration yet: it is the value.
      return span > 0 ? area / span : (watts[last] ?? 0);
    },
    reset() {
      start = 0;
      count = 0;
    },
  };
}

export type CadenceJudgement = 'low' | 'ok' | 'high';

export function judgeCadence(
  rpm: number,
  target: number,
  tolerance = CADENCE_TOLERANCE_RPM,
): CadenceJudgement {
  if (rpm < target - tolerance) return 'low';
  if (rpm > target + tolerance) return 'high';
  return 'ok';
}
