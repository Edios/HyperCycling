import { describe, expect, it } from 'vitest';
import { FitBuilder, T, fitTime } from '../fit/__fixtures__/fit-builder';
import { RIDE_FILE_LIMITS, readRideBytes, rideFormatOf } from './read';

const fit = new FitBuilder()
  .def(0, 20, [
    [253, 4, T.uint32],
    [7, 2, T.uint16],
  ])
  .data(0, [fitTime('2026-11-22T08:00:00Z'), 200])
  .file();

describe('readRideBytes', () => {
  it('knows ride files by their extension, in any case', () => {
    expect(rideFormatOf('Morning_Ride.FIT')).toBe('fit');
    expect(rideFormatOf('ride.fit')).toBe('fit');
    expect(rideFormatOf('plan.zwo')).toBeUndefined();
    expect(rideFormatOf('fit')).toBeUndefined();
  });

  it('reads a FIT file', () => {
    const r = readRideBytes('ride.fit', fit);
    expect(r.ok && r.ride.samples).toEqual([{ t: Date.parse('2026-11-22T08:00:00Z'), power: 200 }]);
  });

  it('refuses other files, empty files and files over the limit', () => {
    expect(readRideBytes('plan.zwo', fit)).toEqual({
      ok: false,
      error: { code: 'unsupportedType' },
    });
    expect(readRideBytes('ride.fit', new Uint8Array())).toEqual({
      ok: false,
      error: { code: 'empty' },
    });
    const big = new Uint8Array(RIDE_FILE_LIMITS.fit + 1);
    expect(readRideBytes('ride.fit', big)).toEqual({
      ok: false,
      error: { code: 'tooLarge', limit: RIDE_FILE_LIMITS.fit },
    });
  });
});
