// Fixtures written by hand from the GSS CSC Measurement table (little-endian).
import { describe, expect, it } from 'vitest';
import { parseCscMeasurement } from './csc';

const b = (...bytes: number[]) => Uint8Array.of(...bytes);

describe('parseCscMeasurement', () => {
  it('no data flags', () => {
    expect(parseCscMeasurement(b(0x00))).toEqual({});
  });

  it('bit 0: wheel data (uint32 revs, 1/1024 s)', () => {
    expect(parseCscMeasurement(b(0x01, 0x10, 0x27, 0x00, 0x00, 0x00, 0x04))).toEqual({
      wheel: { revs: 10000, eventTime1024: 1024 },
    });
  });

  it('bit 1: crank data (uint16 revs, 1/1024 s)', () => {
    expect(parseCscMeasurement(b(0x02, 0x05, 0x00, 0x00, 0x08))).toEqual({
      crank: { revs: 5, eventTime1024: 2048 },
    });
  });

  it('both: crank data follows the 6-byte wheel data, counters at their maximum', () => {
    expect(
      parseCscMeasurement(b(0x03, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff)),
    ).toEqual({
      wheel: { revs: 0xffffffff, eventTime1024: 0xffff },
      crank: { revs: 0xffff, eventTime1024: 0xffff },
    });
  });

  it('names the missing field on short packets', () => {
    expect(() => parseCscMeasurement(b())).toThrow(/"Flags"/);
    expect(() => parseCscMeasurement(b(0x01, 0x10, 0x27, 0x00, 0x00, 0x00))).toThrow(
      /"Last Wheel Event Time"/,
    );
    expect(() => parseCscMeasurement(b(0x03, 0, 0, 0, 0, 0, 0, 0x05))).toThrow(
      /"Cumulative Crank Revolutions"/,
    );
  });
});
