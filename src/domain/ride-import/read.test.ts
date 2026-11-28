import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FitBuilder, T, fitTime } from '../fit/__fixtures__/fit-builder';
import { gpx, points, tcx } from './__fixtures__/xml-rides';
import {
  GZIP_FILE_LIMIT,
  RIDE_FILE_LIMITS,
  gunzip,
  importRideBytes,
  readRideBytes,
  rideFileKind,
  uploadLimit,
} from './read';

const TS = fitTime('2026-11-22T08:00:00Z');

/** A FIT ride of `n` seconds at 200 W. */
function fit(n: number): Uint8Array {
  const b = new FitBuilder().def(0, 20, [
    [253, 4, T.uint32],
    [7, 2, T.uint16],
  ]);
  for (let i = 0; i < n; i += 1) b.data(0, [TS + i, 200]);
  return b.file();
}

const text = (s: string) => new TextEncoder().encode(s);

afterEach(() => vi.unstubAllGlobals());

describe('rideFileKind', () => {
  it('knows ride files by their extension, in any case, also gzipped', () => {
    expect(rideFileKind('Morning_Ride.FIT')).toEqual({ format: 'fit', gzip: false });
    expect(rideFileKind('a.tcx')).toEqual({ format: 'tcx', gzip: false });
    expect(rideFileKind('123.gpx.gz')).toEqual({ format: 'gpx', gzip: true });
    expect(rideFileKind('plan.zwo')).toBeUndefined();
    expect(rideFileKind('fit')).toBeUndefined();
    expect(rideFileKind('a.gz')).toBeUndefined();
    expect(uploadLimit({ format: 'tcx', gzip: false })).toBe(RIDE_FILE_LIMITS.tcx);
    expect(uploadLimit({ format: 'tcx', gzip: true })).toBe(GZIP_FILE_LIMIT);
  });
});

describe('readRideBytes', () => {
  it('reads FIT, TCX and GPX', () => {
    expect(readRideBytes('ride.fit', fit(1))).toMatchObject({ ok: true, ride: { format: 'fit' } });
    expect(readRideBytes('a.tcx', text(tcx([[{ sec: 0 }]])))).toMatchObject({
      ok: true,
      ride: { format: 'tcx' },
    });
    expect(readRideBytes('a.gpx', text(gpx([[{ sec: 0 }]])))).toMatchObject({
      ok: true,
      ride: { format: 'gpx' },
    });
  });

  it('refuses other files, empty files and files over the limit', () => {
    expect(readRideBytes('plan.zwo', fit(1))).toEqual({
      ok: false,
      error: { code: 'unsupportedType' },
    });
    expect(readRideBytes('ride.fit', new Uint8Array())).toEqual({
      ok: false,
      error: { code: 'empty' },
    });
    expect(readRideBytes('ride.fit', new Uint8Array(RIDE_FILE_LIMITS.fit + 1))).toEqual({
      ok: false,
      error: { code: 'tooLarge', limit: RIDE_FILE_LIMITS.fit },
    });
  });
});

describe('importRideBytes', () => {
  it('reads and puts a ride on the 1 Hz axis, with the warnings of both steps', async () => {
    const r = await importRideBytes('ride.fit', fit(400));
    expect(r.ok && r.series.durationSec).toBe(400);
    const run = tcx([points(400, () => ({ power: 3000 }))], { sport: 'Running' });
    expect(await importRideBytes('run.tcx', text(run))).toMatchObject({
      ok: true,
      warnings: ['notCycling', 'implausibleValues'],
    });
  });

  it('passes on the errors of reading and of the series', async () => {
    expect(await importRideBytes('a.zwo', fit(1))).toEqual({
      ok: false,
      error: { code: 'unsupportedType' },
    });
    expect(await importRideBytes('a.fit', new Uint8Array())).toEqual({
      ok: false,
      error: { code: 'empty' },
    });
    expect(await importRideBytes('a.fit', new Uint8Array(RIDE_FILE_LIMITS.fit + 1))).toEqual({
      ok: false,
      error: { code: 'tooLarge', limit: RIDE_FILE_LIMITS.fit },
    });
    expect(await importRideBytes('a.gpx', text('<gpx>'))).toEqual({
      ok: false,
      error: { code: 'xmlInvalid' },
    });
    expect(await importRideBytes('a.fit', fit(10))).toEqual({
      ok: false,
      error: { code: 'tooShort' },
    });
  });

  it('unpacks gzip (a bulk Strava export)', async () => {
    const r = await importRideBytes(
      'activity.gpx.gz',
      gzipSync(text(gpx([points(400, (i) => ({ lat: 50 + i * 1e-4, lon: 20 }))]))),
    );
    expect(r.ok && r.series.format).toBe('gpx');
    expect(r.ok && r.series.coverage.speed).toBeGreaterThan(0.99);
    expect(await importRideBytes('a.fit.gz', new Uint8Array(GZIP_FILE_LIMIT + 1))).toEqual({
      ok: false,
      error: { code: 'tooLarge', limit: GZIP_FILE_LIMIT },
    });
    expect(await importRideBytes('a.fit.gz', text('not gzip at all'))).toEqual({
      ok: false,
      error: { code: 'gzipFailed' },
    });
  });

  it('stops unpacking past the limit (a "zip bomb" stays small)', async () => {
    const bomb = gzipSync(new Uint8Array(RIDE_FILE_LIMITS.fit + 1));
    expect(bomb.length).toBeLessThan(GZIP_FILE_LIMIT);
    expect(await importRideBytes('a.fit.gz', bomb)).toEqual({
      ok: false,
      error: { code: 'tooLarge', limit: RIDE_FILE_LIMITS.fit },
    });
    const small = await gunzip(gzipSync(text('hello')), 100);
    expect(small.ok && new TextDecoder().decode(small.bytes)).toBe('hello');
  }, 60_000); // 20 MB comes out in small chunks: slow on a busy machine

  it('asks to unpack the file by hand where the browser cannot', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    expect(await importRideBytes('a.tcx.gz', gzipSync(text('x')))).toEqual({
      ok: false,
      error: { code: 'gzipUnsupported' },
    });
  });
});
