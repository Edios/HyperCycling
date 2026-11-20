import { describe, expect, it } from 'vitest';
import { FakeHrSensor } from './fake-hr';
import { parseHeartRateMeasurement } from './hrs';

describe('FakeHrSensor', () => {
  it('defaults: 120 bpm as uint8 with contact', () => {
    expect(Array.from(new FakeHrSensor().measure(0))).toEqual([0x06, 120]);
    expect(parseHeartRateMeasurement(new FakeHrSensor().measure(0))).toEqual({
      bpm: 120,
      contact: 'ok',
      rrMs: [],
    });
  });

  it('follows the bpm scenario relative to startMs', () => {
    const hr = new FakeHrSensor({ startMs: 10_000, bpm: (t) => 100 + t / 1000 });
    expect(parseHeartRateMeasurement(hr.measure(40_000)).bpm).toBe(130);
  });

  it('uint16 format carries values above 255; uint8 caps at 255', () => {
    expect(
      parseHeartRateMeasurement(new FakeHrSensor({ format: 'uint16', bpm: () => 300 }).measure(0))
        .bpm,
    ).toBe(300);
    expect(parseHeartRateMeasurement(new FakeHrSensor({ bpm: () => 300 }).measure(0)).bpm).toBe(
      255,
    );
  });

  it('encodes every contact state and can change it later', () => {
    const hr = new FakeHrSensor({ contact: 'unsupported' });
    expect(parseHeartRateMeasurement(hr.measure(0)).contact).toBe('unsupported');
    hr.contact = 'none';
    expect(parseHeartRateMeasurement(hr.measure(0)).contact).toBe('none');
  });

  it('adds energy expended and RR intervals derived from bpm', () => {
    const hr = new FakeHrSensor({ bpm: () => 60, energyKj: 0x0123, rrPerPacket: 2 });
    expect(parseHeartRateMeasurement(hr.measure(0))).toEqual({
      bpm: 60,
      contact: 'ok',
      energyKj: 0x0123,
      rrMs: [1000, 1000],
    });
  });

  it('sends no RR intervals at 0 bpm and never a negative bpm', () => {
    const hr = new FakeHrSensor({ bpm: () => -5, rrPerPacket: 1 });
    expect(parseHeartRateMeasurement(hr.measure(0))).toEqual({ bpm: 0, contact: 'ok', rrMs: [] });
  });
});
