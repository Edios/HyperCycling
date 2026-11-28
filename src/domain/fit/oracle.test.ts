/**
 * Our FIT reader against an independent one: `fit-file-parser` (MIT, a dev dependency used only
 * here, never shipped). Both read the same synthetic files; their record series must agree.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import FitParser from 'fit-file-parser';
import { describe, expect, it } from 'vitest';
import { summarizeRide, type RideRecord } from '../ride';
import { encodeRideToFit } from './encode-ride';
import { readFitRide } from './read-ride';
import type { RawSample } from '../ride-import/types';
import { FitBuilder, T, fitTime } from './__fixtures__/fit-builder';

interface OracleRecord {
  timestamp?: Date | string;
  power?: number;
  cadence?: number;
  heart_rate?: number;
  speed?: number;
  enhanced_speed?: number;
  altitude?: number;
  enhanced_altitude?: number;
  distance?: number;
  position_lat?: number;
  position_long?: number;
}

async function oracle(bytes: Uint8Array): Promise<RawSample[]> {
  const parser = new FitParser({ force: false, speedUnit: 'm/s', lengthUnit: 'm', mode: 'list' });
  const data = (await parser.parseAsync(Buffer.from(bytes))) as { records?: OracleRecord[] };
  return (data.records ?? []).map((r) => {
    const s: RawSample = { t: new Date(r.timestamp ?? 0).getTime() };
    const speed = r.enhanced_speed ?? r.speed;
    const altitude = r.enhanced_altitude ?? r.altitude;
    if (r.power !== undefined) s.power = r.power;
    if (r.cadence !== undefined) s.cadence = r.cadence;
    if (r.heart_rate !== undefined) s.heartRate = r.heart_rate;
    if (speed !== undefined) s.speed = speed;
    if (altitude !== undefined) s.altitude = altitude;
    if (r.distance !== undefined) s.distance = r.distance;
    if (r.position_lat !== undefined) s.lat = r.position_lat;
    if (r.position_long !== undefined) s.lon = r.position_long;
    return s;
  });
}

function ours(bytes: Uint8Array): RawSample[] {
  const r = readFitRide(bytes);
  if (!r.ok) throw new Error(r.error.code);
  return r.ride.samples;
}

/** Same samples, numbers equal to 6 decimal places (degrees and scaled values). */
function expectSameSeries(a: RawSample[], b: RawSample[]) {
  expect(a.length).toBe(b.length);
  a.forEach((s, i) => {
    const o = b[i] ?? { t: NaN };
    expect(Object.keys(s).sort(), `keys of sample ${i}`).toEqual(Object.keys(o).sort());
    for (const [k, v] of Object.entries(s)) {
      expect(v, `${k} of sample ${i}`).toBeCloseTo(o[k as keyof RawSample] ?? NaN, 6);
    }
  });
}

const START = '2026-11-22T08:00:00.000Z';
const TS = fitTime(START);

describe('our FIT reader agrees with fit-file-parser', () => {
  it('on our own export (1 Hz, gaps, missing readings)', async () => {
    const n = 600;
    const samples = {
      timeMs: Array.from({ length: n }, (_, i) => (i + 1) * 1000 + (i > 300 ? 60_000 : 0)),
      power: Array.from({ length: n }, (_, i) => (i % 97 === 0 ? null : 150 + ((i * 37) % 200))),
      cadence: Array.from({ length: n }, (_, i) => (i % 89 === 0 ? null : 80 + (i % 25))),
      heartRate: Array.from({ length: n }, (_, i) => (i % 53 === 0 ? null : 110 + (i % 60))),
      targetW: Array.from({ length: n }, () => 200),
      segmentIndex: Array.from({ length: n }, (_, i) => Math.floor(i / 120)),
    };
    const ride: RideRecord = {
      id: 'oracle',
      schemaVersion: 1,
      sessionLogId: 'oracle',
      workoutId: 'w',
      startedAt: START,
      endedAt: '2026-11-22T08:12:00.000Z',
      sampleSec: 1,
      ftp: 250,
      hrMax: 190,
      samples,
      events: [
        { atSec: 301, atMs: 301_500, kind: 'pause' },
        { atSec: 301, atMs: 361_000, kind: 'resume' },
      ],
      blocks: [],
      summary: summarizeRide(samples, [], 190),
    };
    const bytes = encodeRideToFit(ride);
    expectSameSeries(ours(bytes), await oracle(bytes));
  });

  it('on an outdoor file with GPS, compressed timestamps and big-endian records', async () => {
    const lat0 = Math.round((50.0614 * 2 ** 31) / 180);
    const lon0 = Math.round((19.9366 * 2 ** 31) / 180);
    const b = new FitBuilder()
      .def(0, 0, [
        [0, 1, T.enum],
        [1, 2, T.uint16],
        [4, 4, T.uint32],
      ])
      .data(0, [4, 1, TS])
      .def(
        1,
        20,
        [
          [253, 4, T.uint32],
          [0, 4, T.sint32],
          [1, 4, T.sint32],
          [5, 4, T.uint32],
          [3, 1, T.uint8],
          [4, 1, T.uint8],
          [7, 2, T.uint16],
          [73, 4, T.uint32],
          [78, 4, T.uint32],
        ],
        { be: true },
      )
      .def(2, 20, [
        [0, 4, T.sint32],
        [1, 4, T.sint32],
        [5, 4, T.uint32],
        [7, 2, T.uint16],
        [73, 4, T.uint32],
      ]);
    let ts = TS;
    for (let i = 0; i < 300; i += 1) {
      const lat = lat0 + i * 120;
      const lon = lon0 - i * 75;
      const dist = i * 650;
      const power = i % 41 === 0 ? null : 120 + ((i * 13) % 180);
      const speed = 5000 + ((i * 7) % 3000);
      if (i % 3 === 0) {
        // Smart recording: 1-4 s apart, written with a full timestamp.
        ts += 1 + (i % 4);
        b.data(1, [ts, lat, lon, dist, 120 + (i % 40), 70 + (i % 30), power, speed, 2600 + i]);
      } else {
        ts += 1 + (i % 2);
        b.compressed(2, ts % 32, [lat, lon, dist, power, speed]);
      }
    }
    const bytes = b.file();
    expectSameSeries(ours(bytes), await oracle(bytes));
  });
});

/**
 * Real rides stay off the repository (they hold GPS tracks). To compare on them, point
 * RIDE_IMPORT_REAL_DIR at a folder of .fit files: `RIDE_IMPORT_REAL_DIR=... npx vitest run oracle`.
 */
const realDir = process.env.RIDE_IMPORT_REAL_DIR;
const realFiles = realDir
  ? readdirSync(realDir).filter((f) => f.toLowerCase().endsWith('.fit'))
  : [];

describe.skipIf(realFiles.length === 0)(
  'our FIT reader agrees with fit-file-parser on real rides',
  () => {
    it.each(realFiles)('%s', async (name) => {
      const bytes = new Uint8Array(readFileSync(join(realDir ?? '', name)));
      expectSameSeries(ours(bytes), await oracle(bytes));
    });
  },
);
