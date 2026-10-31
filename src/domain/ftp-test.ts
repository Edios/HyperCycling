import { playerSchema } from './player';

export type FtpTestKind = 'ramp' | 'twenty' | 'twoByEight';

interface FtpTestSpec {
  /** How many measured power values the test yields. */
  inputs: number;
  /** Share of the measured power that counts as FTP. */
  factor: number;
}

export const FTP_TESTS: Readonly<Record<FtpTestKind, FtpTestSpec>> = {
  /** 75 % of the best 1-minute power. */
  ramp: { inputs: 1, factor: 0.75 },
  /** 95 % of the 20-minute average power. */
  twenty: { inputs: 1, factor: 0.95 },
  /** 90 % of the average of the two 8-minute efforts. */
  twoByEight: { inputs: 2, factor: 0.9 },
};

/** Built-in workout id of each FTP test. */
export const FTP_TEST_WORKOUT_IDS: Readonly<Record<string, FtpTestKind>> = Object.freeze({
  'ramp-test': 'ramp',
  'ftp-test-20': 'twenty',
  'ftp-test-2x8': 'twoByEight',
});

/** Which FTP test a workout is, or undefined for any other workout. */
export function ftpTestKindOf(workoutId: string): FtpTestKind | undefined {
  return Object.hasOwn(FTP_TEST_WORKOUT_IDS, workoutId)
    ? FTP_TEST_WORKOUT_IDS[workoutId]
    : undefined;
}

export const FTP_TEST_KINDS: readonly FtpTestKind[] = ['twenty', 'ramp', 'twoByEight'];

/**
 * The shared formula: FTP in whole watts, not range checked. Undefined when the number of values
 * is wrong or a value is not a positive finite number.
 */
export function ftpEstimate(kind: FtpTestKind, watts: readonly number[]): number | undefined {
  const spec = FTP_TESTS[kind];
  if (watts.length !== spec.inputs) return undefined;
  if (!watts.every((w) => Number.isFinite(w) && w > 0)) return undefined;
  const mean = watts.reduce((a, b) => a + b, 0) / watts.length;
  return Math.round(mean * spec.factor);
}

/** The estimate, or undefined when it is missing or outside the player FTP range (50..600). */
export function ftpFromTest(kind: FtpTestKind, watts: readonly number[]): number | undefined {
  const ftp = ftpEstimate(kind, watts);
  return ftp !== undefined && isValidFtp(ftp) ? ftp : undefined;
}

/** Same rule as the player schema: a whole number from 50 to 600. */
export function isValidFtp(ftp: number): boolean {
  return playerSchema.safeParse({ id: 'x', name: 'x', ftp }).success;
}
