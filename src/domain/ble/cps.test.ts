// Fixtures written by hand from the GSS Cycling Power Measurement table (little-endian).
import { describe, expect, it } from 'vitest';
import { parseCyclingPowerMeasurement } from './cps';

const b = (...bytes: number[]) => Uint8Array.of(...bytes);

describe('parseCyclingPowerMeasurement', () => {
  it('always reads instantaneous power (sint16)', () => {
    expect(parseCyclingPowerMeasurement(b(0x00, 0x00, 0xc8, 0x00))).toEqual({ watts: 200 });
    expect(parseCyclingPowerMeasurement(b(0x00, 0x00, 0xf6, 0xff))).toEqual({ watts: -10 });
  });

  it('bit 0: pedal power balance in 0.5 %', () => {
    expect(parseCyclingPowerMeasurement(b(0x01, 0x00, 0xc8, 0x00, 0x65)).balancePct).toBe(50.5);
  });

  it('bits 1 and 3 are flags without a field and do not shift offsets', () => {
    expect(parseCyclingPowerMeasurement(b(0x0a, 0x00, 0xc8, 0x00))).toEqual({ watts: 200 });
  });

  it('bit 2: accumulated torque is skipped before crank data', () => {
    const m = parseCyclingPowerMeasurement(
      b(0x24, 0x00, 0xc8, 0x00, 0x11, 0x22, 0x0a, 0x00, 0x00, 0x04),
    );
    expect(m).toEqual({ watts: 200, crank: { revs: 10, eventTime1024: 1024 } });
  });

  it('bit 4: wheel data with a uint32 counter at its maximum and 1/2048 s time', () => {
    const m = parseCyclingPowerMeasurement(
      b(0x10, 0x00, 0xc8, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0x08),
    );
    expect(m.wheel).toEqual({ revs: 0xffffffff, eventTime2048: 2048 });
  });

  it('bit 5: crank data with a uint16 counter at its maximum', () => {
    const m = parseCyclingPowerMeasurement(b(0x20, 0x00, 0xc8, 0x00, 0xff, 0xff, 0xff, 0xff));
    expect(m.crank).toEqual({ revs: 0xffff, eventTime1024: 0xffff });
  });

  it('all offset-relevant flags together, trailing fields ignored', () => {
    // flags 0x0835: balance, torque, wheel, crank, accumulated energy (bit 11, not read)
    // prettier-ignore
    const m = parseCyclingPowerMeasurement(
      b(
        0x35, 0x08, 0x2c, 0x01, // flags, 300 W
        0x64, // balance 50 %
        0x00, 0x10, // torque (skipped)
        0x40, 0xe2, 0x01, 0x00, 0x00, 0x10, // wheel 123456 revs, 4096/2048 s
        0x5a, 0x00, 0x00, 0x0c, // crank 90 revs, 3072/1024 s
        0x05, 0x00, // accumulated energy 5 kJ
      ),
    );
    expect(m).toEqual({
      watts: 300,
      balancePct: 50,
      wheel: { revs: 123456, eventTime2048: 4096 },
      crank: { revs: 90, eventTime1024: 3072 },
    });
  });

  it('names the missing field on short packets', () => {
    expect(() => parseCyclingPowerMeasurement(b(0x00, 0x00, 0xc8))).toThrow(
      /"Instantaneous Power"/,
    );
    expect(() => parseCyclingPowerMeasurement(b(0x04, 0x00, 0xc8, 0x00, 0x01))).toThrow(
      /"Accumulated Torque"/,
    );
    expect(() => parseCyclingPowerMeasurement(b(0x20, 0x00, 0xc8, 0x00, 0x01, 0x00))).toThrow(
      /"Last Crank Event Time"/,
    );
  });
});
