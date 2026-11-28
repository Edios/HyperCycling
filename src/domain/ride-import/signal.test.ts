import { describe, expect, it } from 'vitest';
import { pelt, zoneSplits } from './pelt';
import {
  effortToPct,
  estimateFtp,
  fillGaps,
  hrPctToEffort,
  median,
  movingAverage,
  powerFromSpeed,
} from './signal';
import { ride } from './__fixtures__/synthetic';

describe('signal helpers', () => {
  it('fills gaps with the last value (the first ones with the first value; all empty -> 0)', () => {
    expect(Array.from(fillGaps([NaN, 2, NaN, 4]))).toEqual([2, 2, 2, 4]);
    expect(Array.from(fillGaps([NaN, NaN]))).toEqual([0, 0]);
  });

  it('medians and moving averages', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(Array.from(movingAverage([0, 3, 6], 3))).toEqual([1.5, 3, 4.5]);
  });

  it('reads %FTP off the effort table between its rows, and HR % as zones', () => {
    expect(effortToPct(8)).toBe(100);
    expect(effortToPct(8.5)).toBe(106);
    expect(effortToPct(0)).toBe(45);
    expect(effortToPct(12)).toBe(130);
    expect(hrPctToEffort(50)).toBe(0.5);
    expect(hrPctToEffort(75)).toBe(5.5);
    expect(hrPctToEffort(120)).toBe(10.5);
  });

  it('estimates power from speed: more uphill, never below 0 downhill', () => {
    const flat = powerFromSpeed(9, 0, 75);
    expect(flat).toBeGreaterThan(150);
    expect(flat).toBeLessThan(250);
    expect(powerFromSpeed(5, 6, 75)).toBeGreaterThan(powerFromSpeed(5, 0, 75));
    expect(powerFromSpeed(10, -8, 75)).toBe(0);
  });

  it('suggests 95 % of the best 20 minutes as FTP', () => {
    const r = ride([{ sec: 1500, from: 80 }], { noise: 0 });
    expect(estimateFtp(r)).toBe(190);
    expect(estimateFtp(ride([{ sec: 600, from: 80 }]))).toBeUndefined();
    expect(estimateFtp(ride([{ sec: 1500, from: 0 }], { noise: 0 }))).toBeUndefined();
  });
});

describe('change points', () => {
  it('PELT finds a step and nothing in a flat or too short series', () => {
    const step = [...Array<number>(20).fill(50), ...Array<number>(20).fill(100)];
    expect(pelt(step, 100, 4)).toEqual([20]);
    expect(pelt(Array<number>(40).fill(70), 100, 4)).toEqual([]);
    expect(pelt([1, 2, 3], 1, 4)).toEqual([]);
  });

  it('the zone fallback cuts where the signal leaves the band for long enough', () => {
    const x = [...Array<number>(10).fill(50), 90, 50, ...Array<number>(10).fill(90)];
    expect(zoneSplits(x, 10, 3)).toEqual([12]);
  });
});
