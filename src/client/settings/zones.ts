import { effortTableSchema, type EffortTable } from '../../domain/effort';

export type ZoneError = 'range' | 'increasing';

const MIN_PCT = 20;
const MAX_PCT = 200;

/** Parses one typed % FTP value; undefined when empty or not a number. */
export function parsePct(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Per-row problems for the typed values, mirroring `effortTableSchema`: every value within
 * 20..200 and each strictly above the one before it.
 */
export function zoneErrors(values: readonly string[]): (ZoneError | undefined)[] {
  const nums = values.map(parsePct);
  return nums.map((n, i) => {
    if (n === undefined || n < MIN_PCT || n > MAX_PCT) return 'range';
    const prev = nums[i - 1];
    return prev !== undefined && n <= prev ? 'increasing' : undefined;
  });
}

/** The table with the typed values applied, or undefined when anything is invalid. */
export function applyZoneValues(
  base: EffortTable,
  values: readonly string[],
): EffortTable | undefined {
  if (zoneErrors(values).some(Boolean)) return undefined;
  const next = base.map((row, i) => ({ ...row, ftpPct: parsePct(values[i] ?? '') ?? row.ftpPct }));
  const r = effortTableSchema.safeParse(next);
  return r.success ? r.data : undefined;
}
