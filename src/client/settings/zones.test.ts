import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT_TABLE } from '../../domain/effort';
import { applyZoneValues, zoneErrors } from './zones';

const defaults = DEFAULT_EFFORT_TABLE.map((r) => String(r.ftpPct));
const withRow = (i: number, v: string): string[] => defaults.map((d, k) => (k === i ? v : d));

describe('zoneErrors', () => {
  it('accepts the defaults', () => expect(zoneErrors(defaults).every((e) => !e)).toBe(true));
  it('flags values outside 20..200 and non-numbers', () => {
    expect(zoneErrors(withRow(0, '10'))[0]).toBe('range');
    expect(zoneErrors(withRow(9, '250'))[9]).toBe('range');
    expect(zoneErrors(withRow(3, ''))[3]).toBe('range');
    expect(zoneErrors(withRow(3, 'abc'))[3]).toBe('range');
  });
  it('flags a row that is not above the previous one', () => {
    const e = zoneErrors(withRow(4, '70'));
    expect(e[4]).toBe('increasing');
    expect(zoneErrors(withRow(4, '69'))[4]).toBe('increasing');
  });
  it('flags the next row when a value is raised past it', () => {
    expect(zoneErrors(withRow(2, '90'))[3]).toBe('increasing');
  });
});

describe('applyZoneValues', () => {
  it('returns the new table for valid values', () => {
    const t = applyZoneValues(DEFAULT_EFFORT_TABLE, withRow(0, '40'));
    expect(t?.[0]?.ftpPct).toBe(40);
    expect(t?.[0]?.color).toBe('#8fa3b8');
  });
  it('returns undefined for invalid values', () => {
    expect(applyZoneValues(DEFAULT_EFFORT_TABLE, withRow(4, '70'))).toBeUndefined();
  });
});
