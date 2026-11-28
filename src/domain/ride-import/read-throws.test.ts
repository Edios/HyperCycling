import { describe, expect, it, vi } from 'vitest';
import { readRideBytes } from './read';

vi.mock('../fit/read-ride', () => ({
  readFitRide: () => {
    throw new RangeError('boom');
  },
}));

describe('readRideBytes', () => {
  it('turns an unexpected exception in a reader into a coded error, never a crash', () => {
    expect(readRideBytes('ride.fit', new Uint8Array([1]))).toEqual({
      ok: false,
      error: { code: 'parseFailed' },
    });
  });
});
