import { afterEach, describe, expect, it } from 'vitest';
import { rideSchema } from '../../domain/ride';
import {
  buildRideRecord,
  clearRideBuffer,
  createRideRecorder,
  loadRideBuffer,
  rideFileName,
  saveRideBuffer,
} from './ride-recorder';

const meta = {
  id: 'log-1',
  workoutId: 'w1',
  startedAt: '2026-11-21T08:00:00.000Z',
  endedAt: '2026-11-21T08:10:00.000Z',
  ftp: 250,
  hrMax: 190,
  blocks: [{ segmentIndex: 0, score: 90, met: true, measuredSec: 2 }],
};

describe('ride recorder', () => {
  afterEach(() => clearRideBuffer());

  it('records one sample per call, missing or bad readings as null, events at the current second', () => {
    let clock = 1_000_000;
    const r = createRideRecorder(undefined, () => clock);
    r.sample({ powerW: 200, cadenceRpm: 90, hrBpm: 140, targetW: 210, segmentIndex: 0 });
    clock += 400;
    r.event('pause');
    clock += 60_000; // a minute of pause: the gap shows in the wall-clock times
    r.sample({ powerW: null, cadenceRpm: Number.NaN, hrBpm: -1, targetW: null, segmentIndex: 1 });
    clock -= 5000; // the clock going back never reorders the record
    r.event('resume');
    expect(r.data()).toEqual({
      originMs: 1_000_000,
      samples: {
        timeMs: [0, 60_400],
        power: [200, null],
        cadence: [90, null],
        heartRate: [140, null],
        targetW: [210, null],
        segmentIndex: [0, 1],
      },
      events: [
        { atSec: 1, atMs: 400, kind: 'pause' },
        { atSec: 2, atMs: 60_400, kind: 'resume' },
      ],
    });
  });

  it('builds a valid, versioned record keyed by the session log id', () => {
    let clock = Date.parse('2026-11-21T08:00:03.000Z');
    const r = createRideRecorder(undefined, () => (clock += 1000));
    r.sample({ powerW: 200, cadenceRpm: 90, hrBpm: 140, targetW: 210, segmentIndex: 0 });
    r.sample({ powerW: 220, cadenceRpm: 92, hrBpm: 150, targetW: 210, segmentIndex: 0 });
    const ride = buildRideRecord(r.data(), meta);
    expect(ride).not.toBeNull();
    expect(rideSchema.safeParse(ride).success).toBe(true);
    expect(ride).toMatchObject({
      id: 'log-1',
      sessionLogId: 'log-1',
      schemaVersion: 1,
      // The wall-clock origin of the samples: the first sample.
      startedAt: '2026-11-21T08:00:04.000Z',
      samples: { timeMs: [0, 1000] },
      summary: { avgPowerW: 210, avgHr: 145, blocksMet: 1, executionPct: 90 },
    });
    // The record is a copy: later samples do not change it.
    r.sample({ powerW: 999, cadenceRpm: 90, hrBpm: 140, targetW: 210, segmentIndex: 0 });
    expect(ride!.samples.power).toEqual([200, 220]);
  });

  it('nothing is saved when no sensor sent anything', () => {
    const r = createRideRecorder();
    r.sample({ powerW: null, cadenceRpm: null, hrBpm: null, targetW: 200, segmentIndex: 0 });
    expect(buildRideRecord(r.data(), meta)).toBeNull();
  });

  it('keeps a reload buffer per workout in session storage', () => {
    const r = createRideRecorder();
    r.sample({ powerW: 180, cadenceRpm: 85, hrBpm: null, targetW: 200, segmentIndex: 2 });
    saveRideBuffer('w1', r.data());
    expect(loadRideBuffer('w2')).toBeUndefined();
    const kept = loadRideBuffer('w1');
    expect(kept?.samples.power).toEqual([180]);
    // A recorder started from the buffer carries on.
    const again = createRideRecorder(kept);
    again.sample({ powerW: 190, cadenceRpm: 86, hrBpm: null, targetW: 200, segmentIndex: 2 });
    expect(again.data().samples.power).toEqual([180, 190]);
    clearRideBuffer();
    expect(loadRideBuffer('w1')).toBeUndefined();
    sessionStorage.setItem('hypercycling.rideBuffer', '{"workoutId":"w1","samples":{}}');
    expect(loadRideBuffer('w1')).toBeUndefined();
  });

  it('names the file after the start time', () => {
    expect(rideFileName({ startedAt: 'nonsense' })).toBe('hypercycling-ride-ride.json');
    expect(rideFileName({ startedAt: '2026-11-21T08:05:00.000Z' })).toMatch(
      /^hypercycling-ride-2026-11-2\d-\d{4}\.json$/,
    );
  });
});
