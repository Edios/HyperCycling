import { ftpPctToEffort } from '../effort';
import { newId } from '../ids';
import { workoutSchema, type Block, type Intensity, type Workout } from '../workout';
import type { ImportResult, ParseOptions } from './types';

const MIN_PCT = 20;
const MAX_PCT = 200;
const MIN_RPM = 30;
const MAX_RPM = 150;
const MAX_DURATION_SEC = 14400;
const MAX_NAME = 80;
const DEFAULT_NAME = 'Imported workout';

export function intensityFromPct(pct: number): Intensity {
  return { ftpPct: pct, effort: ftpPctToEffort(pct) };
}

/** Clamps %FTP into the range the schema accepts, recording a warning when it had to. */
export function clampPct(pct: number, where: string, warnings: string[]): number {
  if (pct < MIN_PCT || pct > MAX_PCT) {
    const clamped = Math.min(MAX_PCT, Math.max(MIN_PCT, pct));
    warnings.push(`${where}: intensity ${pct}% FTP is out of range, clamped to ${clamped}%`);
    return clamped;
  }
  return pct;
}

export function clampRpm(rpm: number, where: string, warnings: string[]): number {
  const rounded = Math.round(rpm);
  if (rounded < MIN_RPM || rounded > MAX_RPM) {
    const clamped = Math.min(MAX_RPM, Math.max(MIN_RPM, rounded));
    warnings.push(`${where}: cadence ${rpm} rpm is out of range, clamped to ${clamped}`);
    return clamped;
  }
  return rounded;
}

export function clampDuration(sec: number, where: string, warnings: string[]): number {
  if (sec > MAX_DURATION_SEC) {
    warnings.push(`${where}: duration ${sec}s is too long, clamped to ${MAX_DURATION_SEC}s`);
    return MAX_DURATION_SEC;
  }
  return sec;
}

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function baseName(fileName: string | undefined): string {
  if (!fileName) return '';
  const last = fileName.split(/[\\/]/).pop() ?? '';
  return last.replace(/\.[^.]*$/, '').trim();
}

export function finishWorkout(args: {
  name: string;
  description: string;
  blocks: Block[];
  warnings: string[];
  opts: ParseOptions | undefined;
}): ImportResult {
  const { blocks, warnings, opts } = args;
  if (blocks.length === 0) return { ok: false, error: 'No workout blocks found' };
  const name = (args.name.trim() || baseName(opts?.fileName) || DEFAULT_NAME).slice(0, MAX_NAME);
  const workout: Workout = {
    id: newId(),
    name,
    description: args.description.trim(),
    category: 'freestyle',
    tags: [],
    source: opts?.fileName ? { kind: 'import', file: opts.fileName } : { kind: 'import' },
    blocks,
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: (opts?.now ?? new Date()).toISOString(),
  };
  const checked = workoutSchema.safeParse(workout);
  /* c8 ignore next 4 -- defensive: parsers clamp every value to schema ranges */
  if (!checked.success) {
    const first = checked.error.issues[0];
    return {
      ok: false,
      error: `Imported workout is invalid: ${first?.message ?? 'unknown error'}`,
    };
  }
  return { ok: true, workout: checked.data, warnings };
}
