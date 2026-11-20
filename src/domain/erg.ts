/**
 * ERG decisions as pure functions: the target in watts for a moment of the workout, when a block is
 * a sprint (fixed resistance instead of ERG), the soft ramp for big jumps, when a new target is
 * worth writing, and the optional cadence guard. The driver in client/devices applies them.
 *
 * Owner decisions (plans/trainer-decisions.md): D2 automatic sprint mode, on by default;
 * D4 cadence guard optional, off by default; D3 the owner's FTP.
 */

import type { Segment } from './segments';

export interface PowerRange {
  min: number;
  max: number;
  step: number;
}

/** Used when the trainer reports no range or a nonsensical one (oss-trainer-pitfalls #3). */
export const DEFAULT_POWER_RANGE: PowerRange = { min: 0, max: 1500, step: 1 };

/** The trainer's range if it makes sense, else the default. */
export function sanePowerRange(range: PowerRange | null | undefined): PowerRange {
  if (!range) return DEFAULT_POWER_RANGE;
  const { min, max, step } = range;
  const ok =
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    Number.isFinite(step) &&
    min >= 0 &&
    min < max &&
    max >= 100 &&
    max <= 4000 &&
    step >= 1 &&
    step <= 50;
  return ok ? range : DEFAULT_POWER_RANGE;
}

/** ERG never asks for more than this share of FTP, whatever the block says. */
export const ERG_CAP_PCT = 200;
/** ±% intensity adjustment the rider can set during a ride (Zwift / Rouvy style). */
export const BIAS_STEP_PCT = 5;
export const BIAS_MIN_PCT = -50;
export const BIAS_MAX_PCT = 50;

export function clampBias(pct: number): number {
  return Math.min(BIAS_MAX_PCT, Math.max(BIAS_MIN_PCT, Math.round(pct)));
}

/** Target watts: FTP × %FTP × (1 + bias), capped, clamped to the trainer's range and step. */
export function ergTargetWatts({
  ftp,
  ftpPct,
  biasPct = 0,
  range = DEFAULT_POWER_RANGE,
  capPct = ERG_CAP_PCT,
}: {
  ftp: number;
  ftpPct: number;
  biasPct?: number;
  range?: PowerRange;
  capPct?: number;
}): number {
  const raw = ((ftp * ftpPct) / 100) * (1 + clampBias(biasPct) / 100);
  const capped = Math.min(raw, (ftp * capPct) / 100);
  const clamped = Math.min(range.max, Math.max(range.min, capped));
  const stepped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, stepped));
}

/** Blocks shorter than this, or this hard, ride on fixed resistance (D2). */
export const SPRINT_MAX_SEC = 30;
export const SPRINT_MIN_EFFORT = 9;
/** Resistance level for sprints, % (proposal R2, owner to confirm). */
export const SPRINT_RESISTANCE_PCT = 40;

export type ControlMode = 'erg' | 'resistance';

export function isSprint(
  segment: Pick<Segment, 'durationSec' | 'effortStart' | 'effortEnd'>,
): boolean {
  return (
    segment.durationSec < SPRINT_MAX_SEC ||
    Math.max(segment.effortStart, segment.effortEnd) >= SPRINT_MIN_EFFORT
  );
}

export function controlModeFor(
  segment: Pick<Segment, 'durationSec' | 'effortStart' | 'effortEnd'>,
  sprintMode: boolean,
): ControlMode {
  return sprintMode && isSprint(segment) ? 'resistance' : 'erg';
}

/** Jumps larger than this share of FTP are spread over RAMP_MS (knees, fewer jolts). */
export const RAMP_JUMP_FTP_SHARE = 0.3;
export const RAMP_MS = 3000;

export interface Ramp {
  fromW: number;
  toW: number;
  startMs: number;
}

/** A ramp for a new target, or null when the jump is small enough to send at once. */
export function startRamp(
  fromW: number | null,
  toW: number,
  ftp: number,
  nowMs: number,
): Ramp | null {
  if (fromW === null || Math.abs(toW - fromW) <= RAMP_JUMP_FTP_SHARE * ftp) return null;
  return { fromW, toW, startMs: nowMs };
}

export function rampValue(ramp: Ramp, nowMs: number): number {
  const k = Math.min(1, Math.max(0, (nowMs - ramp.startMs) / RAMP_MS));
  return Math.round(ramp.fromW + (ramp.toW - ramp.fromW) * k);
}

/** At most one target write per second (the trainer answers each one). */
export const MIN_WRITE_INTERVAL_MS = 1000;

/**
 * Whether a new target should be written now: always the first one and at a block boundary,
 * otherwise only when it moved by ≥ 3 W or ≥ 1 % FTP and the last write is ≥ 1 s old.
 */
export function shouldWrite({
  lastW,
  lastAtMs,
  nextW,
  nowMs,
  ftp,
  boundary,
}: {
  lastW: number | null;
  lastAtMs: number | null;
  nextW: number;
  nowMs: number;
  ftp: number;
  boundary: boolean;
}): boolean {
  if (lastW === null || lastAtMs === null || boundary) return true;
  if (nowMs - lastAtMs < MIN_WRITE_INTERVAL_MS) return false;
  return Math.abs(nextW - lastW) >= Math.max(3, 0.01 * ftp);
}

// ---------------------------------------------------------------------------------------------
// Cadence guard (optional, off by default, D4)
// ---------------------------------------------------------------------------------------------

export const GUARD_LOW_RPM = 55;
export const GUARD_LOW_MS = 3000;
export const GUARD_RECOVER_RPM = 70;
export const GUARD_FACTOR = 0.5;
export const GUARD_RECOVER_MS = 5000;

export type GuardState =
  | { phase: 'ok' }
  | { phase: 'low'; sinceMs: number }
  | { phase: 'active' }
  | { phase: 'recovering'; sinceMs: number };

export const GUARD_IDLE: GuardState = { phase: 'ok' };

/** Next guard state from the latest cadence (null = no data: the state is kept). */
export function stepGuard(state: GuardState, rpm: number | null, nowMs: number): GuardState {
  if (rpm === null) return state;
  switch (state.phase) {
    case 'ok':
      return rpm < GUARD_LOW_RPM ? { phase: 'low', sinceMs: nowMs } : state;
    case 'low':
      if (rpm >= GUARD_LOW_RPM) return GUARD_IDLE;
      return nowMs - state.sinceMs >= GUARD_LOW_MS ? { phase: 'active' } : state;
    case 'active':
      return rpm > GUARD_RECOVER_RPM ? { phase: 'recovering', sinceMs: nowMs } : state;
    case 'recovering':
      if (rpm < GUARD_LOW_RPM) return { phase: 'active' };
      return nowMs - state.sinceMs >= GUARD_RECOVER_MS ? GUARD_IDLE : state;
  }
}

/** Multiplier for the target: 1, 0.5 while active, ramping back to 1 while recovering. */
export function guardFactor(state: GuardState, nowMs: number): number {
  if (state.phase === 'active') return GUARD_FACTOR;
  if (state.phase === 'recovering') {
    const k = Math.min(1, Math.max(0, (nowMs - state.sinceMs) / GUARD_RECOVER_MS));
    return GUARD_FACTOR + (1 - GUARD_FACTOR) * k;
  }
  return 1;
}
