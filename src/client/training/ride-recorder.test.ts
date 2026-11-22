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

  const live = { powerW: 200, cadenceRpm: 90, hrBpm: 140, targetW: 210, segmentIndex: 0 };

  it('samples by the riding clock: a 5 s clock jump gives 5 samples, the missed ones null', () => {
    let clock = 1_000_000;
    const r = createRideRecorder(undefined, () => clock);
    r.run();
    clock += 1000;
    r.catchUp(live);
    clock += 5000; // the timer was throttled for 5 s
    r.catchUp({ ...live, powerW: 250, segmentIndex: 1 });
    const { samples } = r.data();
    expect(samples.power).toEqual([200, null, null, null, null, 250]);
    expect(samples.timeMs).toEqual([1000, 2000, 3000, 4000, 5000, 6000]);
    expect(samples.segmentIndex).toEqual([0, 0, 0, 0, 0, 1]);
    // Bad readings are null, never 0.
    clock += 1000;
    r.catchUp({ ...live, cadenceRpm: Number.NaN, hrBpm: -1 });
    expect(r.data().samples.cadence.at(-1)).toBeNull();
    expect(r.data().samples.heartRate.at(-1)).toBeNull();
  });

  it('a 30 s pause is not ridden, and its length can be read back from the record', () => {
    let clock = Date.parse('2026-11-21T08:00:00.000Z');
    const r = createRideRecorder(undefined, () => clock);
    r.run();
    clock += 3000;
    r.halt(live);
    r.event('pause');
    clock += 30_000;
    r.catchUp(live); // nothing is due while halted
    r.event('resume');
    r.run();
    clock += 2000;
    r.catchUp(live);
    const ride = buildRideRecord(r.data(), meta)!;
    expect(rideSchema.safeParse(ride).success).toBe(true);
    expect(ride.summary.ridingSec).toBe(5);
    const pause = ride.events.find((e) => e.kind === 'pause')!;
    const resume = ride.events.find((e) => e.kind === 'resume')!;
    expect(resume.atMs - pause.atMs).toBe(30_000);
    expect(ride.samples.timeMs).toEqual([1000, 2000, 3000, 34_000, 35_000]);
    expect(ride.startedAt).toBe('2026-11-21T08:00:00.000Z');
  });

  it('skipping blocks moves the workout, not the time ridden', () => {
    let clock = 0;
    const r = createRideRecorder(undefined, () => clock);
    r.run();
    clock += 1000;
    r.catchUp(live);
    clock += 1000;
    r.catchUp({ ...live, segmentIndex: 4 }); // the rider skipped ahead three blocks
    expect(r.data().samples.power).toEqual([200, 200]);
    expect(r.data().samples.segmentIndex).toEqual([0, 4]);
  });

  it('builds a valid, versioned record keyed by the session log id', () => {
    let clock = 0;
    const r = createRideRecorder(undefined, () => clock);
    r.run();
    clock += 2000;
    r.catchUp({ ...live, powerW: 220, hrBpm: 150 });
    const ride = buildRideRecord(r.data(), meta);
    expect(ride).toMatchObject({
      id: 'log-1',
      sessionLogId: 'log-1',
      schemaVersion: 1,
      summary: { blocksMet: 1, executionPct: 90 },
    });
    clock += 1000;
    r.catchUp(live);
    expect(ride!.samples.power).toHaveLength(2); // the record is a copy
  });

  it('nothing is saved when no sensor sent anything', () => {
    let clock = 0;
    const r = createRideRecorder(undefined, () => clock);
    r.run();
    clock += 2000;
    r.catchUp({ ...live, powerW: null, cadenceRpm: null, hrBpm: null });
    expect(buildRideRecord(r.data(), meta)).toBeNull();
  });

  it('keeps a reload buffer per workout; a resumed recorder carries on its riding clock', () => {
    let clock = 0;
    const r = createRideRecorder(undefined, () => clock);
    r.run();
    clock += 1000;
    r.catchUp(live);
    saveRideBuffer('w1', r.data());
    expect(loadRideBuffer('w2')).toBeUndefined();
    const kept = loadRideBuffer('w1');
    expect(kept?.samples.power).toEqual([200]);
    clock += 60_000; // the reload
    const again = createRideRecorder(kept, () => clock);
    again.run();
    clock += 1000;
    again.catchUp(live);
    expect(again.data().samples.power).toEqual([200, 200]);
    expect(again.data().samples.timeMs).toEqual([1000, 62_000]);
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
    expect(rideFileName({ startedAt: '2026-11-21T08:05:00.000Z' }, 'fit')).toMatch(/\.fit$/);
  });
});
