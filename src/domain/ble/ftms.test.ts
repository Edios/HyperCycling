/**
 * Byte fixtures are written by hand from the field tables (GSS Indoor Bike Data, Supported Power
 * Range, Supported Resistance Level Range; FTMS Control Point and Status per the research report).
 * Every multi-byte value is little-endian.
 */
import { describe, expect, it } from 'vitest';
import { BleParseError } from './bytes';
import {
  mergeIndoorBikeData,
  parseControlPointResponse,
  parseFitnessMachineFeature,
  parseIndoorBikeData,
  parseMachineStatus,
  parseSupportedPowerRange,
  parseSupportedResistanceRange,
  requestControl,
  reset,
  setIndoorBikeSimulation,
  setTargetPower,
  setTargetResistance,
  startOrResume,
  stopOrPause,
} from './ftms';

const b = (...bytes: number[]) => Uint8Array.of(...bytes);
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

describe('parseIndoorBikeData: one flag at a time', () => {
  // Bit 0 is set ("More Data") in every row except the first, so only the tested field is present.
  const cases: [string, Uint8Array, object][] = [
    ['bit 0 = 0: instantaneous speed 32.50 km/h', b(0x00, 0x00, 0xb2, 0x0c), { speedKmh: 32.5 }],
    ['bit 0 = 1: no speed', b(0x01, 0x00), {}],
    ['bit 1: average speed 25.00 km/h', b(0x03, 0x00, 0xc4, 0x09), { avgSpeedKmh: 25 }],
    ['bit 2: cadence 90.5 rpm', b(0x05, 0x00, 0xb5, 0x00), { cadenceRpm: 90.5 }],
    ['bit 3: average cadence 80 rpm', b(0x09, 0x00, 0xa0, 0x00), { avgCadenceRpm: 80 }],
    ['bit 4: total distance 74565 m', b(0x11, 0x00, 0x45, 0x23, 0x01), { totalDistanceM: 74565 }],
    ['bit 5: resistance sint16 -5', b(0x21, 0x00, 0xfb, 0xff), { resistanceLevel: -5 }],
    ['bit 5: resistance uint8 10', b(0x21, 0x00, 0x0a), { resistanceLevel: 10 }],
    ['bit 6: power 200 W', b(0x41, 0x00, 0xc8, 0x00), { powerW: 200 }],
    ['bit 6: power -10 W', b(0x41, 0x00, 0xf6, 0xff), { powerW: -10 }],
    ['bit 7: average power 180 W', b(0x81, 0x00, 0xb4, 0x00), { avgPowerW: 180 }],
    [
      'bit 8: energy 300 kcal, 600 kcal/h, 10 kcal/min',
      b(0x01, 0x01, 0x2c, 0x01, 0x58, 0x02, 0x0a),
      { totalEnergyKcal: 300, energyPerHourKcal: 600, energyPerMinuteKcal: 10 },
    ],
    ['bit 9: heart rate 142', b(0x01, 0x02, 0x8e), { heartRateBpm: 142 }],
    ['bit 10: MET 8.5', b(0x01, 0x04, 0x55), { met: 8.5 }],
    ['bit 11: elapsed 3600 s', b(0x01, 0x08, 0x10, 0x0e), { elapsedSec: 3600 }],
    ['bit 12: remaining 1200 s', b(0x01, 0x10, 0xb0, 0x04), { remainingSec: 1200 }],
  ];

  it.each(cases)('%s', (_name, bytes, expected) => {
    expect(parseIndoorBikeData(bytes)).toEqual(expected);
  });
});

describe('parseIndoorBikeData: every field', () => {
  // prettier-ignore
  const allFields = (resistance: number[]) =>
    b(
      0xfe, 0x1f, // flags 0x1FFE: bit 0 = 0 (speed present), bits 1-12 set
      0xb2, 0x0c, // speed 32.50 km/h
      0xc4, 0x09, // average speed 25.00 km/h
      0xb4, 0x00, // cadence 90 rpm
      0xa0, 0x00, // average cadence 80 rpm
      0x45, 0x23, 0x01, // distance 74565 m
      ...resistance,
      0xc8, 0x00, // power 200 W
      0xb4, 0x00, // average power 180 W
      0x2c, 0x01, 0x58, 0x02, 0x0a, // energy 300 kcal, 600 kcal/h, 10 kcal/min
      0x8e, // heart rate 142
      0x55, // MET 8.5
      0x10, 0x0e, // elapsed 3600 s
      0xb0, 0x04, // remaining 1200 s
    );
  const expected = {
    speedKmh: 32.5,
    avgSpeedKmh: 25,
    cadenceRpm: 90,
    avgCadenceRpm: 80,
    totalDistanceM: 74565,
    powerW: 200,
    avgPowerW: 180,
    totalEnergyKcal: 300,
    energyPerHourKcal: 600,
    energyPerMinuteKcal: 10,
    heartRateBpm: 142,
    met: 8.5,
    elapsedSec: 3600,
    remainingSec: 1200,
  };

  it('parses all 13 flags with a sint16 resistance level (FTMS 1.0 layout)', () => {
    const bytes = allFields([0x07, 0x00]);
    expect(bytes.length).toBe(30);
    expect(parseIndoorBikeData(bytes)).toEqual({ ...expected, resistanceLevel: 7 });
  });

  it('parses all 13 flags with a uint8 resistance level (GSS layout)', () => {
    const bytes = allFields([0x07]);
    expect(bytes.length).toBe(29);
    expect(parseIndoorBikeData(bytes)).toEqual({ ...expected, resistanceLevel: 7 });
  });

  it('accepts a DataView like Web Bluetooth delivers', () => {
    const bytes = allFields([0x07, 0x00]);
    expect(parseIndoorBikeData(new DataView(bytes.buffer)).powerW).toBe(200);
  });
});

describe('parseIndoorBikeData: errors', () => {
  it('names the missing field when a packet is too short', () => {
    expect(() => parseIndoorBikeData(b(0x41, 0x00, 0xc8))).toThrow(/"Instantaneous Power"/);
    expect(() => parseIndoorBikeData(b(0x00, 0x00, 0xb2))).toThrow(/"Instantaneous Speed"/);
    expect(() => parseIndoorBikeData(b(0x01))).toThrow(BleParseError);
    expect(() => parseIndoorBikeData(b(0x01))).toThrow(/"Flags"/);
  });

  it('reports a truncated resistance level', () => {
    expect(() => parseIndoorBikeData(b(0x21, 0x00))).toThrow(/"Resistance Level"/);
  });
});

describe('mergeIndoorBikeData', () => {
  it('a resistance field appearing mid-session does not shift power (pitfall 1.4)', () => {
    // Before a resistance target: cadence + power. After: the trainer adds Resistance Level.
    const before = parseIndoorBikeData(b(0x45, 0x00, 0xb4, 0x00, 0xc8, 0x00));
    const after = parseIndoorBikeData(b(0x65, 0x00, 0xb4, 0x00, 0xc8, 0x00, 0xc8, 0x00));
    const merged = mergeIndoorBikeData(before, after);
    expect(merged.powerW).toBe(200);
    expect(merged.resistanceLevel).toBe(200);
    expect(merged.cadenceRpm).toBe(90);
  });

  it('joins two split notifications into a complete reading', () => {
    // First: More Data + cadence + power. Second: speed + elapsed time.
    const first = parseIndoorBikeData(b(0x45, 0x00, 0xb4, 0x00, 0xc8, 0x00));
    const second = parseIndoorBikeData(b(0x00, 0x08, 0xb2, 0x0c, 0x3c, 0x00));
    expect(mergeIndoorBikeData(first, second)).toEqual({
      cadenceRpm: 90,
      powerW: 200,
      speedKmh: 32.5,
      elapsedSec: 60,
    });
  });

  it('newer values win and absent ones keep the last known value', () => {
    const merged = mergeIndoorBikeData({ powerW: 150, cadenceRpm: 80 }, { powerW: 210 });
    expect(merged).toEqual({ powerW: 210, cadenceRpm: 80 });
  });
});

describe('parseFitnessMachineFeature', () => {
  it('reads ERG-capable features (cadence, power measurement, target power)', () => {
    const f = parseFitnessMachineFeature(b(0x02, 0x40, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00));
    expect(f).toEqual({
      machineFeatures: 0x4002,
      targetSettingFeatures: 0x08,
      supportsCadence: true,
      supportsPowerMeasurement: true,
      supportsHeartRate: false,
      supportsTargetPower: true,
      supportsResistance: false,
      supportsSimulation: false,
    });
  });

  it('reads resistance, simulation and heart rate bits', () => {
    const f = parseFitnessMachineFeature(b(0x00, 0x04, 0x00, 0x00, 0x04, 0x20, 0x00, 0x00));
    expect(f.supportsHeartRate).toBe(true);
    expect(f.supportsCadence).toBe(false);
    expect(f.supportsTargetPower).toBe(false);
    expect(f.supportsResistance).toBe(true);
    expect(f.supportsSimulation).toBe(true);
  });

  it('keeps high bits of the 32-bit fields unsigned', () => {
    const f = parseFitnessMachineFeature(b(0, 0, 0, 0x80, 0, 0, 0, 0x80));
    expect(f.machineFeatures).toBe(0x80000000);
    expect(f.targetSettingFeatures).toBe(0x80000000);
  });

  it('fails on a short packet', () => {
    expect(() => parseFitnessMachineFeature(b(0, 0, 0, 0, 0))).toThrow(/"Target Setting Features"/);
  });
});

describe('supported ranges', () => {
  it('parses the power range', () => {
    expect(parseSupportedPowerRange(b(0x00, 0x00, 0xdc, 0x05, 0x01, 0x00))).toEqual({
      min: 0,
      max: 1500,
      step: 1,
    });
    expect(parseSupportedPowerRange(b(0xf6, 0xff, 0xe8, 0x03, 0x05, 0x00)).min).toBe(-10);
    expect(() => parseSupportedPowerRange(b(0, 0, 0, 0))).toThrow(/"Minimum Increment"/);
  });

  it('parses the resistance range in the 3-byte GSS form', () => {
    expect(parseSupportedResistanceRange(b(0x00, 0xc8, 0x01))).toEqual({
      min: 0,
      max: 200,
      step: 1,
    });
  });

  it('parses the resistance range in the 6-byte FTMS 1.0 form', () => {
    expect(parseSupportedResistanceRange(b(0x00, 0x00, 0xe8, 0x03, 0x0a, 0x00))).toEqual({
      min: 0,
      max: 1000,
      step: 10,
    });
    expect(() => parseSupportedResistanceRange(b(0, 0, 0, 0))).toThrow(/"Minimum Increment"/);
  });
});

describe('Control Point encoders', () => {
  it('encodes commands without parameters', () => {
    expect(hex(requestControl())).toBe('00');
    expect(hex(reset())).toBe('01');
    expect(hex(startOrResume())).toBe('07');
  });

  it('encodes stop and pause', () => {
    expect(hex(stopOrPause('stop'))).toBe('08 01');
    expect(hex(stopOrPause('pause'))).toBe('08 02');
  });

  it('encodes target power as sint16 watts', () => {
    expect(hex(setTargetPower(200))).toBe('05 C8 00');
    expect(hex(setTargetPower(1500))).toBe('05 DC 05');
  });

  it('rounds, clips negatives and caps target power', () => {
    expect(hex(setTargetPower(199.6))).toBe('05 C8 00');
    expect(hex(setTargetPower(199.4))).toBe('05 C7 00');
    expect(hex(setTargetPower(-50))).toBe('05 00 00');
    expect(hex(setTargetPower(40000))).toBe('05 FF 7F');
    expect(hex(setTargetPower(Number.NaN))).toBe('05 00 00');
  });

  it('encodes target resistance as sint16 in 0.1 steps, clamped to -100..100 (erratum, Tacx Flux)', () => {
    expect(hex(setTargetResistance(5))).toBe('04 32 00');
    expect(hex(setTargetResistance(42.5))).toBe('04 A9 01');
    expect(hex(setTargetResistance(-1))).toBe('04 F6 FF');
    expect(hex(setTargetResistance(150))).toBe('04 E8 03');
    expect(hex(setTargetResistance(-150))).toBe('04 18 FC');
  });

  it('encodes indoor bike simulation parameters', () => {
    const bytes = setIndoorBikeSimulation({
      windMps: -2.5,
      gradePct: 4.5,
      crr: 0.004,
      cwKgPerM: 0.51,
    });
    expect(hex(bytes)).toBe('11 3C F6 C2 01 28 33');
  });

  it('clamps simulation parameters to their field types', () => {
    const bytes = setIndoorBikeSimulation({ windMps: -50, gradePct: 400, crr: 1, cwKgPerM: -1 });
    expect(hex(bytes)).toBe('11 00 80 FF 7F FF 00');
  });
});

describe('parseControlPointResponse', () => {
  const cases: [number, string][] = [
    [0x01, 'success'],
    [0x02, 'notSupported'],
    [0x03, 'invalidParameter'],
    [0x04, 'operationFailed'],
    [0x05, 'controlNotPermitted'],
    [0x09, 'unknown'],
  ];

  it.each(cases)('result code 0x%s', (code, result) => {
    expect(parseControlPointResponse(b(0x80, 0x05, code))).toEqual({
      requestOpcode: 0x05,
      resultCode: code,
      result,
      parameters: new Uint8Array(0),
    });
  });

  it('returns response parameters after the result code', () => {
    const backing = b(0xaa, 0x80, 0x13, 0x01, 0x05, 0x06);
    const res = parseControlPointResponse(new DataView(backing.buffer, 1));
    expect(res.requestOpcode).toBe(0x13);
    expect(Array.from(res.parameters)).toEqual([0x05, 0x06]);
  });

  it('rejects a packet that is not a response', () => {
    expect(() => parseControlPointResponse(b(0x05, 0xc8, 0x00))).toThrow(
      /expected op code 0x80, got 0x05/,
    );
  });

  it('rejects a truncated response', () => {
    expect(() => parseControlPointResponse(b(0x80, 0x05))).toThrow(/"Result Code"/);
  });
});

describe('parseMachineStatus', () => {
  it('parses known status codes', () => {
    expect(parseMachineStatus(b(0x01))).toEqual({ kind: 'reset' });
    expect(parseMachineStatus(b(0x02, 0x01))).toEqual({ kind: 'stoppedOrPaused', reason: 'stop' });
    expect(parseMachineStatus(b(0x02, 0x02))).toEqual({ kind: 'stoppedOrPaused', reason: 'pause' });
    expect(parseMachineStatus(b(0x02, 0x07))).toEqual({
      kind: 'stoppedOrPaused',
      reason: 'unknown',
    });
    expect(parseMachineStatus(b(0x02))).toEqual({ kind: 'stoppedOrPaused', reason: 'unknown' });
    expect(parseMachineStatus(b(0x04))).toEqual({ kind: 'startedOrResumed' });
    expect(parseMachineStatus(b(0x07, 0x32))).toEqual({
      kind: 'targetResistanceChanged',
      level: 5,
    });
    expect(parseMachineStatus(b(0x07, 0xf6, 0xff))).toEqual({
      kind: 'targetResistanceChanged',
      level: -1,
    });
    expect(parseMachineStatus(b(0x08, 0xc8, 0x00))).toEqual({
      kind: 'targetPowerChanged',
      watts: 200,
    });
    expect(parseMachineStatus(b(0x12, 0x3c, 0xf6, 0xc2, 0x01, 0x28, 0x33))).toEqual({
      kind: 'simulationChanged',
      params: { windMps: -2.5, gradePct: 4.5, crr: 0.004, cwKgPerM: 0.51 },
    });
    expect(parseMachineStatus(b(0xff))).toEqual({ kind: 'controlPermissionLost' });
  });

  it('keeps unknown codes', () => {
    expect(parseMachineStatus(b(0x05, 0x10, 0x27))).toEqual({ kind: 'unknown', code: 0x05 });
  });

  it('fails on empty or truncated packets', () => {
    expect(() => parseMachineStatus(b())).toThrow(/"Op Code"/);
    expect(() => parseMachineStatus(b(0x08, 0xc8))).toThrow(/"New Target Power"/);
  });
});
