/**
 * "Test the trainer in a minute": reads power, cadence and heart rate for 15 s, then sends one ERG
 * step (100 W → 150 W) and measures how fast and how closely the trainer follows. A setup check
 * for the owner's real-trainer test (T7) and for support; it never runs during a ride and does not
 * use the ride's ERG driver. At the end it hands control back (Stop, Reset).
 */

import {
  requestControl,
  reset,
  setTargetPower,
  startOrResume,
  stopOrPause,
  type ControlPointResponse,
} from '../../domain/ble/ftms';
import type { MessageKey } from '../i18n';
import type { DeviceStore } from './device-store';

export interface Sample {
  atMs: number;
  powerW?: number;
  cadenceRpm?: number;
  hrBpm?: number;
}

export interface Stats {
  count: number;
  avg: number;
  min: number;
  max: number;
}

export interface ErgStep {
  fromW: number;
  toW: number;
  /** From the command to the first power within ±10 % of the target; null = never reached. */
  reactionMs: number | null;
  /** Mean |power − target| / target over the hold after reaching it, in %; null without data. */
  deviationPct: number | null;
}

export type ErgOutcome =
  | { kind: 'done'; step: ErgStep }
  | { kind: 'unsupported' }
  | { kind: 'refused'; result: string }
  | { kind: 'failed'; message: string };

export interface TrainerTestResult {
  durationMs: number;
  trainerName: string | undefined;
  hrName: string | undefined;
  power: Stats | null;
  cadence: Stats | null;
  hr: Stats | null;
  /** Longest gap between two trainer notifications while reading, ms. */
  maxGapMs: number | null;
  erg: ErgOutcome;
}

export type Level = 'ok' | 'warn' | 'fail';

export interface Verdict {
  level: Level;
  /** Each finding: what it means and what to do (message keys under devices.test.note). */
  notes: MessageKey[];
}

export const READ_MS = 15_000;
export const SETTLE_MS = 5_000;
export const STEP_TIMEOUT_MS = 15_000;
export const HOLD_MS = 5_000;
export const STEP_FROM_W = 100;
export const STEP_TO_W = 150;
/** Within this share of the target counts as "there". */
export const BAND = 0.1;
export const SLOW_REACTION_MS = 10_000;
export const GAP_WARN_MS = 3_000;
export const DEVIATION_WARN_PCT = 10;

export function stats(values: readonly number[]): Stats | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    avg: Math.round(sum / values.length),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/** Readings over the first phase: power, cadence and heart rate, and the longest silence. */
export function analyseReadings(
  samples: readonly Sample[],
): Pick<TrainerTestResult, 'power' | 'cadence' | 'hr' | 'maxGapMs'> {
  const pick = (k: 'powerW' | 'cadenceRpm' | 'hrBpm'): number[] =>
    samples.flatMap((s) => (s[k] === undefined ? [] : [s[k]]));
  const trainerTimes = samples.filter((s) => s.powerW !== undefined || s.cadenceRpm !== undefined);
  let maxGapMs: number | null = null;
  for (let i = 1; i < trainerTimes.length; i += 1) {
    const gap = trainerTimes[i]!.atMs - trainerTimes[i - 1]!.atMs;
    maxGapMs = Math.max(maxGapMs ?? 0, gap);
  }
  return {
    power: stats(pick('powerW')),
    cadence: stats(pick('cadenceRpm')),
    hr: stats(pick('hrBpm')),
    maxGapMs,
  };
}

/** The ERG step: how long until the power reaches the target, then how closely it holds it. */
export function analyseStep(
  samples: readonly Sample[],
  stepAtMs: number,
  fromW: number,
  toW: number,
  holdMs = HOLD_MS,
): ErgStep {
  const powered = samples.filter((s) => s.powerW !== undefined && s.atMs >= stepAtMs);
  const hit = powered.find((s) => Math.abs(s.powerW! - toW) <= toW * BAND);
  if (!hit) return { fromW, toW, reactionMs: null, deviationPct: null };
  const hold = powered.filter((s) => s.atMs >= hit.atMs && s.atMs <= hit.atMs + holdMs);
  const deviation =
    hold.length === 0
      ? null
      : Math.round(
          (hold.reduce((a, s) => a + Math.abs(s.powerW! - toW), 0) / hold.length / toW) * 1000,
        ) / 10;
  return { fromW, toW, reactionMs: hit.atMs - stepAtMs, deviationPct: deviation };
}

/** OK, a warning or a problem, with one plain note (and a hint) per finding. */
export function verdict(result: TrainerTestResult, hrWanted: boolean): Verdict {
  const notes: MessageKey[] = [];
  let level: Level = 'ok';
  const warn = (k: MessageKey): void => {
    notes.push(k);
    if (level === 'ok') level = 'warn';
  };
  const fail = (k: MessageKey): void => {
    notes.push(k);
    level = 'fail';
  };
  if (!result.power) fail('devices.test.note.noPower');
  if (!result.cadence) warn('devices.test.note.noCadence');
  if (result.maxGapMs !== null && result.maxGapMs > GAP_WARN_MS) warn('devices.test.note.gaps');
  if (hrWanted && !result.hr) warn('devices.test.note.noHr');
  const erg = result.erg;
  if (erg.kind === 'unsupported') warn('devices.test.note.noErg');
  else if (erg.kind === 'refused') fail('devices.test.note.ergRefused');
  else if (erg.kind === 'failed') fail('devices.test.note.ergFailed');
  else if (erg.step.reactionMs === null) fail('devices.test.note.ergNever');
  else {
    if (erg.step.reactionMs > SLOW_REACTION_MS) warn('devices.test.note.ergSlow');
    if (erg.step.deviationPct !== null && erg.step.deviationPct > DEVIATION_WARN_PCT)
      warn('devices.test.note.ergOff');
  }
  if (level === 'ok') notes.push('devices.test.note.ok');
  return { level, notes };
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const fmt = (s: Stats | null, unit: string): string =>
  s ? `avg ${s.avg} ${unit} (min ${s.min}, max ${s.max}, ${s.count} samples)` : 'none';

/** Plain-text report for the clipboard and the Bluetooth log (English, like the rest of the log). */
export function reportText(
  result: TrainerTestResult,
  v: Verdict,
  t: Translate,
  date: Date,
): string {
  const erg = result.erg;
  const ergLine =
    erg.kind === 'done'
      ? `step ${erg.step.fromW} -> ${erg.step.toW} W: reaction ${
          erg.step.reactionMs === null
            ? 'never within 10 %'
            : `${(erg.step.reactionMs / 1000).toFixed(1)} s`
        }, deviation ${erg.step.deviationPct === null ? '-' : `${erg.step.deviationPct} %`}`
      : erg.kind === 'refused'
        ? `control refused (${erg.result})`
        : erg.kind === 'failed'
          ? `failed: ${erg.message}`
          : 'trainer does not offer target power';
  return [
    `HyperCycling trainer test ${date.toISOString()}`,
    `trainer: ${result.trainerName ?? '-'} · strap: ${result.hrName ?? '-'}`,
    `power: ${fmt(result.power, 'W')}`,
    `cadence: ${fmt(result.cadence, 'rpm')}`,
    `heart rate: ${fmt(result.hr, 'bpm')}`,
    `longest gap: ${result.maxGapMs === null ? '-' : `${(result.maxGapMs / 1000).toFixed(1)} s`}`,
    `ERG: ${ergLine}`,
    `result: ${v.level.toUpperCase()} · ${v.notes.map((k) => t(k)).join(' ')}`,
  ].join('\n');
}

class ErgCommandError extends Error {}

export type Phase = 'reading' | 'ergSettle' | 'ergStep' | 'release' | 'done';

export interface RunDeps {
  store: DeviceStore;
  now: () => number;
  /** Waits; rejects when the test is cancelled. */
  wait: (ms: number) => Promise<void>;
  onPhase?: (phase: Phase) => void;
  onSample?: (s: Sample) => void;
}

/** Runs the whole test on the connected trainer (and strap, if connected). */
export async function runTrainerTest(deps: RunDeps): Promise<TrainerTestResult> {
  const { store, now, wait } = deps;
  const trainer = store.trainer();
  if (!trainer) throw new Error('No trainer connected');
  const hrStrap = store.hr();
  const state = store.getState();
  const startedAt = now();
  const samples: Sample[] = [];
  const push = (s: Sample): void => {
    samples.push(s);
    deps.onSample?.(s);
  };
  const offData = trainer.onData((r) =>
    push({
      atMs: now(),
      ...(r.packet.powerW !== undefined ? { powerW: r.packet.powerW } : {}),
      ...(r.packet.cadenceRpm !== undefined ? { cadenceRpm: r.packet.cadenceRpm } : {}),
    }),
  );
  const offHr =
    hrStrap?.onReading((r) => push({ atMs: now(), hrBpm: r.measurement.bpm })) ?? (() => undefined);
  let controlled = false;
  // Only a failed command makes the ERG part "failed"; anything else (a cancelled wait) goes up.
  const send = (bytes: Uint8Array): Promise<ControlPointResponse> =>
    trainer.command(bytes).catch((error: unknown) => {
      throw new ErgCommandError((error as Error).message);
    });
  try {
    deps.onPhase?.('reading');
    await wait(READ_MS);
    const readEnd = now();
    const reading = analyseReadings(samples.filter((s) => s.atMs <= readEnd));

    let erg: ErgOutcome;
    if (trainer.features() && !trainer.features()!.supportsTargetPower) {
      erg = { kind: 'unsupported' };
    } else {
      try {
        deps.onPhase?.('ergSettle');
        const res = await send(requestControl());
        if (res.result !== 'success') {
          erg = { kind: 'refused', result: res.result };
        } else {
          controlled = true;
          await send(startOrResume()).catch(() => undefined);
          await send(setTargetPower(STEP_FROM_W));
          await wait(SETTLE_MS);
          deps.onPhase?.('ergStep');
          const stepAt = now();
          await send(setTargetPower(STEP_TO_W));
          // Up to the timeout for the first hit, then the hold; stop early once both are seen.
          const deadline = stepAt + STEP_TIMEOUT_MS + HOLD_MS;
          while (now() < deadline) {
            await wait(500);
            const step = analyseStep(samples, stepAt, STEP_FROM_W, STEP_TO_W);
            if (step.reactionMs !== null && now() >= stepAt + step.reactionMs + HOLD_MS) break;
            if (step.reactionMs === null && now() >= stepAt + STEP_TIMEOUT_MS) break;
          }
          erg = { kind: 'done', step: analyseStep(samples, stepAt, STEP_FROM_W, STEP_TO_W) };
        }
      } catch (error) {
        if (!(error instanceof ErgCommandError)) throw error;
        erg = { kind: 'failed', message: error.message };
      }
    }
    return {
      durationMs: now() - startedAt,
      trainerName: state.trainer.name,
      hrName: state.hr.name,
      ...reading,
      erg,
    };
  } finally {
    offData();
    offHr();
    if (controlled) {
      deps.onPhase?.('release');
      // Give the trainer back: no ERG load left after the test (same as the end of a ride).
      await send(stopOrPause('stop')).catch(() => undefined);
      await send(reset()).catch(() => undefined);
    }
    deps.onPhase?.('done');
  }
}
