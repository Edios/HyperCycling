import { describe, expect, it } from 'vitest';
import { MAX_RIDE_SEC, normalizeRide } from './normalize';
import type { RawRide, RawSample, RideSeries, TimerEvent } from './types';

const T0 = Date.parse('2026-11-22T08:00:00Z');

function raw(samples: RawSample[], over: Partial<RawRide> = {}): RawRide {
  return { format: 'fit', samples, timer: [], laps: [], meta: {}, hints: {}, ...over };
}

/** One sample a second for `n` seconds from second `from`. */
function seconds(n: number, f: (i: number) => Omit<RawSample, 't'>, from = 0): RawSample[] {
  return Array.from({ length: n }, (_, i) => ({ t: T0 + (from + i) * 1000, ...f(i) }));
}

function series(ride: RawRide): { s: RideSeries; warnings: string[] } {
  const r = normalizeRide(ride);
  if (!r.ok) throw new Error(`expected a series, got ${r.error.code}`);
  return { s: r.series, warnings: r.warnings };
}

const arr = (a: Float32Array, from = 0, to = a.length) => Array.from(a.slice(from, to));

describe('normalizeRide', () => {
  it('keeps a clean 1 Hz ride as it is and says which columns have data', () => {
    const { s, warnings } = series(
      raw(seconds(600, (i) => ({ power: 200 + (i % 3), cadence: 90, heartRate: 130 }))),
    );
    expect(warnings).toEqual([]);
    expect(s.durationSec).toBe(600);
    expect(arr(s.power, 0, 4)).toEqual([200, 201, 202, 200]);
    expect(s.coverage).toEqual({
      power: 1,
      cadence: 1,
      heartRate: 1,
      speed: 0,
      altitude: 0,
      distance: 0,
    });
    expect(s.pauses).toEqual([]);
    expect(Number.isNaN(s.speed[0])).toBe(true);
  });

  it('averages power and cadence within a second; heart rate is the last reading', () => {
    const fast: RawSample[] = [];
    for (let sec = 0; sec < 300; sec += 1) {
      for (let q = 0; q < 4; q += 1) {
        fast.push({
          t: T0 + sec * 1000 + q * 250,
          power: 100 + q * 20,
          cadence: 80 + q,
          heartRate: 120 + q,
        });
      }
    }
    const { s } = series(raw(fast));
    expect(s.durationSec).toBe(300);
    expect(arr(s.power, 0, 1)).toEqual([130]);
    expect(arr(s.cadence, 0, 1)).toEqual([81.5]);
    expect(arr(s.heartRate, 0, 1)).toEqual([123]);
  });

  it('fills up to 4 missing seconds in, leaves longer gaps empty, and cuts gaps over 10 s', () => {
    const samples = [
      ...seconds(100, () => ({ power: 100 })),
      { t: T0 + 102_000, power: 160 }, // 3 s later: 2 missing, filled in
      { t: T0 + 110_000, power: 200 }, // 8 s later: 7 missing, left empty
      ...seconds(300, () => ({ power: 220 }), 125), // 15 s later: a pause
    ];
    const { s } = series(raw(samples));
    expect(arr(s.power, 99, 103)).toEqual([100, 120, 140, 160]);
    expect(arr(s.power, 103, 110).every(Number.isNaN)).toBe(true);
    expect(arr(s.power, 109, 111)).toEqual([NaN, 200]);
    expect(s.pauses).toEqual([{ atSec: 111, durationSec: 14 }]);
    expect(s.durationSec).toBe(411);
  });

  it('cuts out the time the timer was stopped, even when readings went on', () => {
    const timer: TimerEvent[] = [
      { t: T0, running: true },
      { t: T0 + 200_000, running: false },
      { t: T0 + 260_000, running: true },
      { t: T0 + 400_000, running: false },
      { t: T0 + 402_000, running: true }, // a 2 s stop with no readings in it
      { t: T0 + 500_000, running: false },
    ];
    const samples = [
      ...seconds(401, () => ({ power: 150 })), // 0..400, readings go on while stopped
      ...seconds(100, () => ({ power: 150 }), 403),
      ...seconds(20, () => ({ power: 150 }), 510), // after the final stop
    ];
    const { s } = series(raw(samples, { timer }));
    expect(s.pauses).toEqual([
      { atSec: 201, durationSec: 59 },
      { atSec: 342, durationSec: 2 },
    ]);
    // 0..200, 260..400, then 403..500 (501 and later are after the final stop)
    expect(s.durationSec).toBe(201 + 141 + 98);
  });

  it('cuts out standing still for more than 30 s, not a short stop at the lights', () => {
    const samples = [
      ...seconds(200, () => ({ speed: 8, power: 150 })),
      ...seconds(20, () => ({ speed: 0, power: 0 }), 200), // 20 s at the lights: kept
      ...seconds(100, () => ({ speed: 8, power: 150 }), 220),
      ...seconds(45, () => ({ speed: 0.2 }), 320), // a café stop: cut
      ...seconds(100, () => ({ speed: 8, power: 150 }), 365),
    ];
    const { s } = series(raw(samples));
    expect(s.pauses).toEqual([{ atSec: 320, durationSec: 45 }]);
    expect(s.durationSec).toBe(420);
  });

  it('leaves out impossible readings, with a warning', () => {
    const samples = seconds(300, (i) =>
      i === 5
        ? { power: 2500, heartRate: 0, cadence: 250, speed: -1 }
        : { power: 200, heartRate: 140 },
    );
    const { s, warnings } = series(raw(samples));
    expect(warnings).toEqual(['implausibleValues']);
    expect(Number.isNaN(s.power[5])).toBe(true);
    expect(Number.isNaN(s.heartRate[5])).toBe(true);
    expect(s.coverage.power).toBeCloseTo(299 / 300);
  });

  it('works out the speed from the distance when there is none (GPX)', () => {
    const { s } = series(
      raw(
        seconds(300, (i) => ({ distance: i * 7, altitude: 100 })),
        { format: 'gpx' },
      ),
    );
    expect(arr(s.speed, 0, 3)).toEqual([NaN, 7, 7]);
    expect(s.coverage.speed).toBeCloseTo(299 / 300);
    expect(s.format).toBe('gpx');
  });

  it('puts the laps on the riding axis, after the cut pauses', () => {
    const samples = [
      ...seconds(200, () => ({ power: 100 })),
      ...seconds(200, () => ({ power: 100 }), 260),
    ];
    const laps = [
      { start: T0, end: T0 + 100_000 },
      { start: T0 + 100_000, end: T0 + 300_000 },
      { start: T0 + 300_000, end: T0 + 460_000 },
      { start: T0 + 900_000, end: T0 + 950_000 }, // after the ride: empty, dropped
    ];
    const { s } = series(raw(samples, { laps }));
    expect(s.laps).toEqual([
      { startSec: 0, endSec: 100 },
      { startSec: 100, endSec: 240 },
      { startSec: 240, endSec: 400 },
    ]);
  });

  it('refuses no readings, under 5 minutes of riding, and over 12 hours', () => {
    expect(normalizeRide(raw([]))).toEqual({ ok: false, error: { code: 'noSamples' } });
    expect(normalizeRide(raw(seconds(299, () => ({ power: 100 }))))).toEqual({
      ok: false,
      error: { code: 'tooShort' },
    });
    expect(normalizeRide(raw(seconds(MAX_RIDE_SEC + 1, () => ({}))))).toEqual({
      ok: false,
      error: { code: 'tooLong' },
    });
  });
});
