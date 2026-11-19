// Fixtures written by hand from the GSS Heart Rate Measurement table (little-endian).
import { describe, expect, it } from 'vitest';
import { parseHeartRateMeasurement } from './hrs';

const b = (...bytes: number[]) => Uint8Array.of(...bytes);

describe('parseHeartRateMeasurement', () => {
  it('reads a uint8 heart rate', () => {
    expect(parseHeartRateMeasurement(b(0x00, 0x48))).toEqual({
      bpm: 72,
      contact: 'unsupported',
      rrMs: [],
    });
  });

  it('reads a uint16 heart rate', () => {
    expect(parseHeartRateMeasurement(b(0x01, 0x2c, 0x01)).bpm).toBe(300);
  });

  it.each([
    [0x00, 'unsupported'],
    [0x02, 'unsupported'], // detected bit without the supported bit
    [0x04, 'none'],
    [0x06, 'ok'],
  ] as const)('flags 0x%s give contact %s', (flags, contact) => {
    expect(parseHeartRateMeasurement(b(flags, 0x50)).contact).toBe(contact);
  });

  it('reads energy expended', () => {
    expect(parseHeartRateMeasurement(b(0x08, 0x50, 0x34, 0x12)).energyKj).toBe(0x1234);
  });

  it('reads zero, one and several RR intervals (1/1024 s → ms)', () => {
    expect(parseHeartRateMeasurement(b(0x10, 0x50)).rrMs).toEqual([]);
    expect(parseHeartRateMeasurement(b(0x10, 0x50, 0x00, 0x04)).rrMs).toEqual([1000]);
    expect(
      parseHeartRateMeasurement(b(0x10, 0x50, 0x00, 0x04, 0x80, 0x03, 0x00, 0x02)).rrMs,
    ).toEqual([1000, 875, 500]);
  });

  it('ignores a stray odd byte after the RR intervals', () => {
    expect(parseHeartRateMeasurement(b(0x10, 0x50, 0x00, 0x04, 0x01)).rrMs).toEqual([1000]);
  });

  it('reads every field together in order', () => {
    expect(parseHeartRateMeasurement(b(0x1f, 0x2c, 0x01, 0x10, 0x00, 0x00, 0x02))).toEqual({
      bpm: 300,
      contact: 'ok',
      energyKj: 16,
      rrMs: [500],
    });
  });

  it('names the missing field on short packets', () => {
    expect(() => parseHeartRateMeasurement(b())).toThrow(/"Flags"/);
    expect(() => parseHeartRateMeasurement(b(0x00))).toThrow(/\(uint8\)"/);
    expect(() => parseHeartRateMeasurement(b(0x01, 0x2c))).toThrow(/\(uint16\)"/);
    expect(() => parseHeartRateMeasurement(b(0x08, 0x50, 0x01))).toThrow(/"Energy Expended"/);
  });
});
