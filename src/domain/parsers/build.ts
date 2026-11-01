import { ftpPctToEffort } from '../effort';
import { newId } from '../ids';
import {
  workoutSchema,
  type Block,
  type Intensity,
  type RampBlock,
  type SteadyBlock,
  type Workout,
} from '../workout';
import type { ImportResult, ParseOptions } from './types';

const MIN_PCT = 20;
const MAX_PCT = 200;
const MIN_RPM = 30;
const MAX_RPM = 150;
const MAX_DURATION_SEC = 14400;
const MAX_NAME = 80;
const DEFAULT_NAME = 'Imported workout';
const MAX_CUE = 200;
const MAX_LABEL = 80;
const MAX_DESCRIPTION = 2000;
const MAX_FILE_NAME = 255;
const MAX_WARNINGS = 50;
export const MAX_BLOCKS = 2000;
const MAX_TEXT_CHARS = 2 * 1024 * 1024;

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

/** Rejects oversized input before any parsing work. Length is a cheap upper bound on bytes/2. */
export function tooLarge(text: string): boolean {
  return text.length > MAX_TEXT_CHARS;
}

export function capWarnings(warnings: string[]): string[] {
  const unique = [...new Set(warnings)];
  if (unique.length <= MAX_WARNINGS) return unique;
  const rest = unique.length - MAX_WARNINGS;
  return [...unique.slice(0, MAX_WARNINGS), `...and ${rest} more warnings`];
}

/** Accepts "0,5" style decimals. Returns NaN when not a number. */
export function parseLooseNumber(raw: string): number {
  const s = raw.trim();
  if (s === '') return NaN;
  const commas = s.split(',').length - 1;
  return Number(commas === 1 ? s.replace(',', '.') : s);
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
  const { blocks, opts } = args;
  if (blocks.length === 0) return { ok: false, error: 'No workout blocks found' };
  let count = 0;
  const trim = (b: SteadyBlock | RampBlock): void => {
    count++;
    if (b.cue !== undefined) b.cue = b.cue.slice(0, MAX_CUE);
    if (b.label !== undefined) b.label = b.label.slice(0, MAX_LABEL);
  };
  for (const b of blocks) {
    if (b.kind === 'repeat') b.blocks.forEach(trim);
    else trim(b);
  }
  if (count > MAX_BLOCKS) return { ok: false, error: 'Too many blocks' };
  const warnings = capWarnings(args.warnings);
  const name = (args.name.trim() || baseName(opts?.fileName) || DEFAULT_NAME).slice(0, MAX_NAME);
  const workout: Workout = {
    id: newId(),
    name,
    description: args.description.trim().slice(0, MAX_DESCRIPTION),
    category: 'freestyle',
    tags: [],
    source: opts?.fileName
      ? { kind: 'import', file: opts.fileName.slice(0, MAX_FILE_NAME) }
      : { kind: 'import' },
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
