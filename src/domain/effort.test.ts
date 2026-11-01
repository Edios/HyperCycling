import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EFFORT_TABLE,
  effortRow,
  effortTableSchema,
  effortToFtpPct,
  ftpPctToEffort,
  targetWatts,
} from './effort';

describe('effort table', () => {
  it('maps 8 → 100', () => expect(effortToFtpPct(8)).toBe(100));
  it('maps 73% → 4 (nearest 70)', () => expect(ftpPctToEffort(73)).toBe(4));
  it('tie goes up: 66 between 62 and 70 → 4', () => expect(ftpPctToEffort(66)).toBe(4));
  it('clamps below/above', () => {
    expect(ftpPctToEffort(10)).toBe(1);
    expect(ftpPctToEffort(300)).toBe(10);
  });
  it('returns exact levels for exact values', () => {
    for (const r of DEFAULT_EFFORT_TABLE) expect(ftpPctToEffort(r.ftpPct)).toBe(r.level);
  });
  it('effortRow returns the row', () => {
    expect(effortRow(9).labelKey).toBe('veryHard');
    expect(effortRow(10).color).toBe('#ff4d4d');
  });
  it('throws on non-finite ftpPct', () => expect(() => ftpPctToEffort(NaN)).toThrow());
  it('uses a custom table', () => {
    const t = DEFAULT_EFFORT_TABLE.map((r) => ({ ...r, ftpPct: r.ftpPct + 1 }));
    expect(effortToFtpPct(8, t)).toBe(101);
    expect(ftpPctToEffort(101, t)).toBe(8);
  });
  it('default table is valid', () => {
    expect(effortTableSchema.safeParse(DEFAULT_EFFORT_TABLE).success).toBe(true);
  });
  it('rejects non-increasing table', () => {
    const bad = DEFAULT_EFFORT_TABLE.map((r) => (r.level === 5 ? { ...r, ftpPct: 60 } : r));
    expect(effortTableSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects out of range, wrong length, wrong order', () => {
    const low = DEFAULT_EFFORT_TABLE.map((r) => (r.level === 1 ? { ...r, ftpPct: 10 } : r));
    expect(effortTableSchema.safeParse(low).success).toBe(false);
    const high = DEFAULT_EFFORT_TABLE.map((r) => (r.level === 10 ? { ...r, ftpPct: 250 } : r));
    expect(effortTableSchema.safeParse(high).success).toBe(false);
    expect(effortTableSchema.safeParse(DEFAULT_EFFORT_TABLE.slice(0, 9)).success).toBe(false);
    expect(effortTableSchema.safeParse([...DEFAULT_EFFORT_TABLE].reverse()).success).toBe(false);
  });
});

describe('targetWatts', () => {
  it('watts', () => expect(targetWatts(270, 92)).toBe(248));
  it('watts never NaN', () => {
    expect(() => targetWatts(NaN, 90)).toThrow();
    expect(() => targetWatts(0, 90)).toThrow();
    expect(() => targetWatts(-5, 90)).toThrow();
    expect(() => targetWatts(Infinity, 90)).toThrow();
    expect(() => targetWatts(200, NaN)).toThrow();
  });
});
