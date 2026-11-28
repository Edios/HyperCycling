import { describe, expect, it } from 'vitest';
import { summarizeRide, type RideRecord } from '../ride';
import { encodeRideToFit } from './encode-ride';
import { MAX_RAW_SAMPLES, readFitRide } from './read-ride';
import { FitBuilder, T, fitTime } from './__fixtures__/fit-builder';

const START = '2026-11-22T08:00:00.000Z';
const START_MS = Date.parse(START);
const TS = fitTime(START);

function ride(): RideRecord {
  // 6 samples at 1 Hz, a 30 s pause after the 3rd, two blocks (the export test's ride).
  const samples = {
    timeMs: [1000, 2000, 3000, 34_000, 35_000, 36_000],
    power: [200, 210, null, 220, 230, 240],
    cadence: [90, 91, null, 92, 93, 94],
    heartRate: [120, 121, 122, null, 124, 125],
    targetW: [200, 200, 200, 220, 220, 220],
    segmentIndex: [0, 0, 0, 1, 1, 1],
  };
  return {
    id: 'ride-1',
    schemaVersion: 1,
    sessionLogId: 'ride-1',
    workoutId: 'w1',
    startedAt: START,
    endedAt: '2026-11-22T08:00:40.000Z',
    sampleSec: 1,
    ftp: 250,
    hrMax: 190,
    samples,
    events: [
      { atSec: 3, atMs: 3000, kind: 'pause' },
      { atSec: 3, atMs: 33_000, kind: 'resume' },
    ],
    blocks: [],
    summary: summarizeRide(samples, [], 190),
  };
}

function read(bytes: Uint8Array) {
  const r = readFitRide(bytes);
  if (!r.ok) throw new Error(`expected a ride, got ${r.error.code}`);
  return r;
}

const FILE_ID: [number, number, number][] = [
  [0, 1, T.enum],
  [1, 2, T.uint16],
  [4, 4, T.uint32],
];
const RECORD: [number, number, number][] = [
  [253, 4, T.uint32],
  [0, 4, T.sint32],
  [1, 4, T.sint32],
  [2, 2, T.uint16],
  [3, 1, T.uint8],
  [4, 1, T.uint8],
  [5, 4, T.uint32],
  [6, 2, T.uint16],
  [7, 2, T.uint16],
  [53, 1, T.uint8],
  [73, 4, T.uint32],
  [78, 4, T.uint32],
];

describe('readFitRide: our own export', () => {
  const { ride: r, warnings } = read(encodeRideToFit(ride()));

  it('gives back every sample with its values, leaving out the missing ones', () => {
    expect(warnings).toEqual([]);
    expect(r.format).toBe('fit');
    expect(r.samples).toEqual([
      { t: START_MS + 1000, power: 200, cadence: 90, heartRate: 120 },
      { t: START_MS + 2000, power: 210, cadence: 91, heartRate: 121 },
      { t: START_MS + 3000, heartRate: 122 },
      { t: START_MS + 34_000, power: 220, cadence: 92 },
      { t: START_MS + 35_000, power: 230, cadence: 93, heartRate: 124 },
      { t: START_MS + 36_000, power: 240, cadence: 94, heartRate: 125 },
    ]);
  });

  it('gives back the timer (the pause), the laps, the sport and the FTP as a hint', () => {
    expect(r.timer).toEqual([
      { t: START_MS, running: true },
      { t: START_MS + 3000, running: false },
      { t: START_MS + 33_000, running: true },
      { t: START_MS + 36_000, running: false },
    ]);
    expect(r.laps).toEqual([
      { start: START_MS, end: START_MS + 3000 },
      { start: START_MS + 3000, end: START_MS + 36_000 },
    ]);
    expect(r.meta).toEqual({
      sport: 'cycling',
      indoor: true,
      device: 'HyperCycling',
      startedAt: START_MS,
      totalElapsedSec: 36,
      totalTimerSec: 6,
    });
    expect(r.hints).toEqual({ ftpW: 250 });
  });
});

describe('readFitRide: other devices', () => {
  it('reads position, altitude, speed, distance and fractional cadence with their scales', () => {
    const b = new FitBuilder()
      .def(0, 0, FILE_ID)
      .data(0, [4, 1, TS])
      .def(1, 20, RECORD)
      // 52.2297 N, 21.0122 E in semicircles; altitude (100 + 500) * 5; 12.345 km; 8.5 m/s
      .data(1, [
        TS,
        Math.round((52.2297 * 2 ** 31) / 180),
        Math.round((21.0122 * 2 ** 31) / 180),
        3000,
        150,
        85,
        1_234_500,
        8500,
        310,
        64,
        null,
        null,
      ])
      // The enhanced speed and altitude win over the plain ones.
      .data(1, [TS + 1, null, null, 3000, null, null, null, 8500, null, null, 9000, 3100]);
    const { ride: r, warnings } = read(b.file());
    expect(warnings).toEqual([]);
    expect(r.meta).toMatchObject({ device: 'Garmin', startedAt: START_MS });
    const [first, second] = r.samples;
    expect(first?.lat).toBeCloseTo(52.2297, 6);
    expect(first?.lon).toBeCloseTo(21.0122, 6);
    expect(first).toMatchObject({
      altitude: 100,
      heartRate: 150,
      cadence: 85.5,
      distance: 12_345,
      speed: 8.5,
      power: 310,
    });
    expect(second).toEqual({ t: START_MS + 1000, speed: 9, altitude: 120 });
  });

  it('takes hints from the profile and zones, within sane ranges, and the sport name', () => {
    const b = new FitBuilder()
      .def(0, 3, [
        [1, 1, T.uint8],
        [4, 2, T.uint16],
      ])
      .data(0, [42, 785]) // age 42, 78.5 kg
      .def(1, 7, [
        [1, 1, T.uint8],
        [3, 2, T.uint16],
      ])
      .data(1, [188, 265])
      .def(2, 12, [
        [0, 1, T.enum],
        [1, 1, T.enum],
        [3, 16, T.string],
      ])
      .data(2, [2, 58, ' Morning ride '])
      .def(3, 20, [
        [253, 4, T.uint32],
        [7, 2, T.uint16],
      ])
      .data(3, [TS, 200]);
    const { ride: r } = read(b.file());
    expect(r.hints).toEqual({ age: 42, weightKg: 78.5, hrMaxBpm: 188, ftpW: 265 });
    expect(r.meta).toEqual({
      sport: 'cycling',
      indoor: true,
      name: 'Morning ride',
      startedAt: START_MS,
    });

    const odd = new FitBuilder()
      .def(0, 3, [
        [1, 1, T.uint8],
        [4, 2, T.uint16],
      ])
      .data(0, [200, 5000]) // 200 years, 500 kg
      .def(1, 7, [
        [1, 1, T.uint8],
        [3, 2, T.uint16],
      ])
      .data(1, [40, 9]) // HR max 40, FTP 9 W
      .def(3, 20, [[253, 4, T.uint32]])
      .data(3, [TS]);
    expect(read(odd.file()).ride.hints).toEqual({});
  });

  it('warns about a run, takes the first session only and ignores other events', () => {
    const session: [number, number, number][] = [
      [253, 4, T.uint32],
      [2, 4, T.uint32],
      [5, 1, T.enum],
      [6, 1, T.enum],
      [7, 4, T.uint32],
      [8, 4, T.uint32],
      [9, 4, T.uint32],
    ];
    const b = new FitBuilder()
      .def(0, 0, FILE_ID)
      .data(0, [4, 9999, TS]) // a maker we do not name
      .def(1, 20, [[253, 4, T.uint32]])
      .data(1, [TS + 10])
      .def(2, 21, [
        [253, 4, T.uint32],
        [0, 1, T.enum],
        [1, 1, T.enum],
      ])
      .data(2, [TS + 10, 0, 0]) // timer start
      .data(2, [TS + 11, 3, 3]) // a marker, not the timer
      .data(2, [TS + 12, 0, 3]) // timer marker: neither start nor stop
      .data(2, [TS + 13, 0, null])
      .data(2, [TS + 14, 0, 8]) // stop_disable counts as a stop
      .def(3, 19, [
        [253, 4, T.uint32],
        [2, 4, T.uint32],
      ])
      .data(3, [TS + 5, TS + 10]) // ends before it starts: ignored
      .def(4, 18, session)
      .data(4, [TS + 20, TS + 10, 1, 0, 600_000, 590_000, 1_000_000])
      .data(4, [TS + 30, TS + 21, 2, 6, 1, 1, 1]);
    const r = read(b.file());
    expect(r.warnings).toEqual(['notCycling']);
    expect(r.ride.meta).toEqual({
      sport: 'running',
      startedAt: START_MS + 10_000,
      totalElapsedSec: 600,
      totalTimerSec: 590,
      totalDistanceM: 10_000,
    });
    expect(r.ride.timer).toEqual([
      { t: START_MS + 10_000, running: true },
      { t: START_MS + 14_000, running: false },
    ]);
    expect(r.ride.laps).toEqual([]);

    const swim = new FitBuilder()
      .def(0, 18, [[5, 1, T.enum]])
      .data(0, [5])
      .def(1, 20, [[253, 4, T.uint32]])
      .data(1, [TS]);
    expect(read(swim.file())).toMatchObject({
      warnings: ['notCycling'],
      ride: { meta: { sport: 'other' } },
    });
  });

  it('puts samples in time order and leaves out the ones without a time', () => {
    const b = new FitBuilder()
      .def(0, 20, [
        [253, 4, T.uint32],
        [7, 2, T.uint16],
      ])
      .data(0, [TS + 2, 120])
      .data(0, [TS, 100])
      .data(0, [null, 999])
      .data(0, [TS + 1, 110]);
    const r = read(b.file());
    expect(r.warnings).toEqual(['samplesWithoutTime']);
    expect(r.ride.samples.map((s) => s.power)).toEqual([100, 110, 120]);
    expect(r.ride.meta.startedAt).toBe(START_MS); // no session or file_id: the first sample
  });

  it('turns a damaged but readable file into warnings', () => {
    const b = new FitBuilder()
      .def(0, 20, [[253, 4, T.uint32]])
      .data(0, [TS])
      .data(0, [TS + 1]);
    expect(read(b.file({ fileCrc: 'bad' })).warnings).toEqual(['fitChecksum']);
    const cut = b.file();
    expect(read(cut.slice(0, cut.length - 4)).warnings).toEqual(['fitIncomplete']);
    expect(read(b.raw(0x07).file()).warnings).toEqual(['fitIncomplete']);
  });
});

describe('readFitRide: refusals', () => {
  it('refuses bytes that are not FIT, or a damaged file with no readings', () => {
    expect(readFitRide(new Uint8Array([1, 2, 3]))).toEqual({
      ok: false,
      error: { code: 'fitCorrupt' },
    });
    const empty = new FitBuilder().def(0, 20, [[253, 4, T.uint32]]).raw(0x03);
    expect(readFitRide(empty.file())).toEqual({ ok: false, error: { code: 'fitCorrupt' } });
  });

  it('refuses a plan or a course (not a ride), and a ride without readings', () => {
    const workout = new FitBuilder().def(0, 0, FILE_ID).data(0, [5, 1, TS]);
    expect(readFitRide(workout.file())).toEqual({
      ok: false,
      error: { code: 'fitNotActivity', fileType: 5 },
    });
    const noRecords = new FitBuilder().def(0, 0, FILE_ID).data(0, [4, 1, TS]);
    expect(readFitRide(noRecords.file())).toEqual({ ok: false, error: { code: 'noSamples' } });
  });

  it('refuses more readings than a 12 hour ride can have', () => {
    const b = new FitBuilder()
      .def(0, 20, [[253, 4, T.uint32]])
      .def(1, 20, [])
      .data(0, [TS]);
    for (let i = 0; i < MAX_RAW_SAMPLES; i += 1) b.body.push(0x80 | (1 << 5) | ((TS + i) % 32));
    expect(readFitRide(b.file())).toEqual({ ok: false, error: { code: 'tooLong' } });
  });
});
