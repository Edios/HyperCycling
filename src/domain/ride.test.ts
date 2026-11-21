import { describe, expect, it } from 'vitest';
import {
  emptySamples,
  hasData,
  hrZoneSeconds,
  normalizedPower,
  rideSchema,
  summarizeRide,
  type RideRecord,
  type RideSamples,
} from './ride';

function samples(power: (number | null)[], extra: Partial<RideSamples> = {}): RideSamples {
  const n = power.length;
  return {
    power,
    cadence: extra.cadence ?? Array<number | null>(n).fill(90),
    heartRate: extra.heartRate ?? Array<number | null>(n).fill(null),
    targetW: extra.targetW ?? Array<number | null>(n).fill(200),
    segmentIndex: extra.segmentIndex ?? Array<number>(n).fill(0),
  };
}

describe('normalizedPower', () => {
  it('equals the power of a steady ride', () => {
    expect(normalizedPower(Array(60).fill(200))).toBe(200);
  });

  it('is above the average for a variable ride; gaps are skipped, not counted as 0 W', () => {
    const variable = [...Array(60).fill(100), ...Array(60).fill(300)];
    expect(normalizedPower(variable)).toBeGreaterThan(200);
    expect(normalizedPower([...Array(30).fill(200), null, null, ...Array(30).fill(200)])).toBe(200);
  });

  it('needs 30 s of power', () => {
    expect(normalizedPower(Array(29).fill(200))).toBeNull();
  });
});

describe('hrZoneSeconds', () => {
  it('places every second with HR into zones 1–5 of HRmax', () => {
    // HRmax 200: 90 (45 %) → Z1, 130 (65 %) → Z2, 150 → Z3, 170 → Z4, 190 → Z5, 210 → Z5
    expect(hrZoneSeconds([90, 130, 150, 170, 190, 210, null], 200)).toEqual([1, 1, 1, 1, 2]);
    expect(hrZoneSeconds([150], null)).toBeNull();
    expect(hrZoneSeconds([null, null], 200)).toBeNull();
  });
});

describe('summarizeRide', () => {
  it('averages over samples with data, work in kJ, execution from blocks', () => {
    const s = samples([100, 200, null, 300], {
      cadence: [80, 90, null, 100],
      heartRate: [120, 140, 160, null],
    });
    const sum = summarizeRide(
      s,
      [
        { segmentIndex: 0, score: 100, met: true, measuredSec: 30 },
        { segmentIndex: 1, score: 40, met: false, measuredSec: 90 },
      ],
      200,
    );
    expect(sum).toEqual({
      ridingSec: 4,
      avgPowerW: 200,
      maxPowerW: 300,
      normalizedPowerW: null,
      workKj: 0.6,
      avgCadence: 90,
      maxCadence: 100,
      avgHr: 140,
      maxHr: 160,
      hrZoneSec: [0, 1, 1, 1, 0],
      executionPct: 55,
      blocksMet: 1,
      blocksTotal: 2,
    });
  });

  it('a strap-only ride has no power figures', () => {
    const s = samples(Array(10).fill(null), {
      cadence: Array(10).fill(null),
      heartRate: Array(10).fill(130),
    });
    const sum = summarizeRide(s, [], null);
    expect(sum).toMatchObject({ avgPowerW: null, workKj: null, avgHr: 130, executionPct: null });
    expect(hasData(s)).toBe(true);
    expect(hasData(emptySamples())).toBe(false);
  });
});

describe('rideSchema', () => {
  const record = (): RideRecord => {
    const s = samples([150, 160]);
    return {
      id: 'log-1',
      schemaVersion: 1,
      sessionLogId: 'log-1',
      workoutId: 'w1',
      startedAt: '2026-11-21T08:00:00.000Z',
      endedAt: '2026-11-21T09:00:00.000Z',
      sampleSec: 1,
      ftp: 250,
      hrMax: null,
      samples: s,
      events: [{ atSec: 1, kind: 'pause' }],
      blocks: [],
      summary: summarizeRide(s, [], null),
    };
  };

  it('accepts a valid record', () => {
    expect(rideSchema.parse(record())).toEqual(record());
  });

  it('rejects arrays of different lengths and unknown versions', () => {
    const bad = record();
    bad.samples.cadence.push(90);
    expect(rideSchema.safeParse(bad).success).toBe(false);
    expect(rideSchema.safeParse({ ...record(), schemaVersion: 2 }).success).toBe(false);
  });
});
