import { describe, expect, it } from 'vitest';
import {
  FTP_TEST_WORKOUT_IDS,
  ftpEstimate,
  ftpFromTest,
  ftpTestKindOf,
  isValidFtp,
} from './ftp-test';

describe('ftpFromTest', () => {
  it('ramp is 75 % of the best minute', () => expect(ftpFromTest('ramp', [320])).toBe(240));
  it('20-minute is 95 % of the average', () => expect(ftpFromTest('twenty', [250])).toBe(238));
  it('2x8 is 90 % of the mean of both efforts', () =>
    expect(ftpFromTest('twoByEight', [270, 260])).toBe(239));
  it('rejects a wrong number of values, zero, negatives and NaN', () => {
    expect(ftpFromTest('twoByEight', [270])).toBeUndefined();
    expect(ftpFromTest('ramp', [])).toBeUndefined();
    expect(ftpFromTest('ramp', [0])).toBeUndefined();
    expect(ftpFromTest('ramp', [-5])).toBeUndefined();
    expect(ftpFromTest('ramp', [Number.NaN])).toBeUndefined();
  });
  it('rejects results outside 50..600', () => {
    expect(ftpFromTest('ramp', [40])).toBeUndefined();
    expect(ftpFromTest('twenty', [900])).toBeUndefined();
  });
});

describe('isValidFtp', () => {
  it('accepts whole numbers 50..600 only', () => {
    expect(isValidFtp(50)).toBe(true);
    expect(isValidFtp(600)).toBe(true);
    expect(isValidFtp(49)).toBe(false);
    expect(isValidFtp(601)).toBe(false);
    expect(isValidFtp(200.5)).toBe(false);
  });
});

describe('ftpEstimate', () => {
  it('applies the shared formula without the 50..600 range check', () => {
    expect(ftpEstimate('ramp', [1000])).toBe(750);
    expect(ftpEstimate('twenty', [250])).toBe(238);
    expect(ftpEstimate('twoByEight', [270, 260])).toBe(239);
  });
  it('is undefined for a wrong count or non-positive values', () => {
    expect(ftpEstimate('twoByEight', [270])).toBeUndefined();
    expect(ftpEstimate('ramp', [0])).toBeUndefined();
  });
});

describe('ftpTestKindOf', () => {
  it('maps the three FTP test workouts to their kind', () => {
    expect(ftpTestKindOf('ramp-test')).toBe('ramp');
    expect(ftpTestKindOf('ftp-test-20')).toBe('twenty');
    expect(ftpTestKindOf('ftp-test-2x8')).toBe('twoByEight');
    expect(Object.keys(FTP_TEST_WORKOUT_IDS)).toHaveLength(3);
  });
  it('is undefined for any other workout', () => {
    expect(ftpTestKindOf('sweet-spot-2x10')).toBeUndefined();
    expect(ftpTestKindOf('toString')).toBeUndefined();
  });
});
