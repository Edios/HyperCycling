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

export const FTP_TEST_KINDS: readonly FtpTestKind[] = ['ramp', 'twenty', 'twoByEight'];

/**
 * FTP estimated from a test, rounded to whole watts. Undefined when a measured value is missing,
 * not a positive finite number, or the result is outside the player FTP range (50..600).
 */
export function ftpFromTest(kind: FtpTestKind, watts: readonly number[]): number | undefined {
  const spec = FTP_TESTS[kind];
  if (watts.length !== spec.inputs) return undefined;
  if (!watts.every((w) => Number.isFinite(w) && w > 0)) return undefined;
  const mean = watts.reduce((a, b) => a + b, 0) / watts.length;
  const ftp = Math.round(mean * spec.factor);
  return isValidFtp(ftp) ? ftp : undefined;
}

/** Same rule as the player schema: a whole number from 50 to 600. */
export function isValidFtp(ftp: number): boolean {
  return playerSchema.safeParse({ id: 'x', name: 'x', ftp }).success;
}
