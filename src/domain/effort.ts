import { z } from 'zod';

export type EffortLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type EffortLabelKey =
  | 'veryEasy'
  | 'easy'
  | 'steady'
  | 'endurance'
  | 'tempo'
  | 'hardTempo'
  | 'hard'
  | 'threshold'
  | 'veryHard'
  | 'max';

export interface EffortRow {
  level: EffortLevel;
  labelKey: EffortLabelKey;
  ftpPct: number;
  color: string;
}

/** Exactly 10 rows, sorted by level, ftpPct strictly increasing. */
export type EffortTable = readonly EffortRow[];

export const DEFAULT_EFFORT_TABLE: EffortTable = [
  { level: 1, labelKey: 'veryEasy', ftpPct: 45, color: '#8fdcff' },
  { level: 2, labelKey: 'easy', ftpPct: 55, color: '#8fdcff' },
  { level: 3, labelKey: 'steady', ftpPct: 62, color: '#2f6bff' },
  { level: 4, labelKey: 'endurance', ftpPct: 70, color: '#2f6bff' },
  { level: 5, labelKey: 'tempo', ftpPct: 78, color: '#35d07f' },
  { level: 6, labelKey: 'hardTempo', ftpPct: 85, color: '#35d07f' },
  { level: 7, labelKey: 'hard', ftpPct: 92, color: '#ffd23f' },
  { level: 8, labelKey: 'threshold', ftpPct: 100, color: '#ff8c2a' },
  { level: 9, labelKey: 'veryHard', ftpPct: 112, color: '#ff4d4d' },
  { level: 10, labelKey: 'max', ftpPct: 130, color: '#ff4d4d' },
];

const levelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
  z.literal(10),
]);

export const effortLevelSchema: z.ZodType<EffortLevel> = levelSchema;

const labelKeySchema = z.enum([
  'veryEasy',
  'easy',
  'steady',
  'endurance',
  'tempo',
  'hardTempo',
  'hard',
  'threshold',
  'veryHard',
  'max',
]);

const effortRowSchema = z.object({
  level: levelSchema,
  labelKey: labelKeySchema,
  ftpPct: z.number().min(20).max(200),
  color: z.string().min(1),
});

export const effortTableSchema: z.ZodType<EffortTable> = z
  .array(effortRowSchema)
  .length(10)
  .superRefine((rows, ctx) => {
    rows.forEach((row, i) => {
      if (row.level !== i + 1) {
        ctx.addIssue({ code: 'custom', message: 'rows must be sorted by level 1..10', path: [i] });
      }
      const prev = rows[i - 1];
      if (prev && row.ftpPct <= prev.ftpPct) {
        ctx.addIssue({ code: 'custom', message: 'ftpPct must be strictly increasing', path: [i] });
      }
    });
  });

export function effortRow(
  level: EffortLevel,
  table: EffortTable = DEFAULT_EFFORT_TABLE,
): EffortRow {
  const row = table[level - 1];
  if (!row) throw new Error(`No effort row for level ${level}`);
  return row;
}

export function effortToFtpPct(
  level: EffortLevel,
  table: EffortTable = DEFAULT_EFFORT_TABLE,
): number {
  return effortRow(level, table).ftpPct;
}

/** Nearest table value; a tie goes to the higher level. Out-of-range values clamp to 1..10. */
export function ftpPctToEffort(
  ftpPct: number,
  table: EffortTable = DEFAULT_EFFORT_TABLE,
): EffortLevel {
  if (!Number.isFinite(ftpPct)) throw new Error(`ftpPct must be finite, got ${ftpPct}`);
  let best = table[0];
  if (!best) throw new Error('Effort table is empty');
  let bestDist = Math.abs(ftpPct - best.ftpPct);
  for (const row of table) {
    const dist = Math.abs(ftpPct - row.ftpPct);
    if (dist <= bestDist) {
      best = row;
      bestDist = dist;
    }
  }
  return best.level;
}

export function targetWatts(ftp: number, ftpPct: number): number {
  if (!Number.isFinite(ftp) || ftp <= 0)
    throw new Error(`ftp must be a positive number, got ${ftp}`);
  if (!Number.isFinite(ftpPct)) throw new Error(`ftpPct must be finite, got ${ftpPct}`);
  return Math.round((ftp * ftpPct) / 100);
}
