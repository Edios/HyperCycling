import { describe, expect, it, vi } from 'vitest';
import { gpx, points } from './__fixtures__/xml-rides';
import { importRideBytes, readRideBytes } from './read';

vi.mock('../fit/read-ride', () => ({
  readFitRide: () => {
    throw new RangeError('boom');
  },
}));
vi.mock('./normalize', () => ({
  normalizeRide: () => {
    throw new RangeError('boom');
  },
}));

describe('a reader or the normalisation that throws', () => {
  it('becomes a coded error, never a crash', async () => {
    expect(readRideBytes('ride.fit', new Uint8Array([1]))).toEqual({
      ok: false,
      error: { code: 'parseFailed' },
    });
    const ride = new TextEncoder().encode(gpx([points(10, () => ({}))]));
    expect(await importRideBytes('ride.gpx', ride)).toEqual({
      ok: false,
      error: { code: 'parseFailed' },
    });
  });
});
