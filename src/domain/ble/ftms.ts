/**
 * Fitness Machine Service (FTMS, 0x1826) codecs for an indoor bike: pure functions from bytes to
 * objects and back. No Web Bluetooth here.
 *
 * Sources: Bluetooth SIG GATT Specification Supplement (GSS) YAML files for Indoor Bike Data,
 * Supported Power Range and Supported Resistance Level Range (bitbucket.org/bluetooth-SIG/public,
 * folder gss/). Feature, Control Point and Status are defined only in the FTMS 1.0 PDF, which was
 * not reachable from this session; those values follow the research report and carry TODO(spec).
 */

import {
  BleParseError,
  ByteReader,
  ByteWriter,
  clampInt,
  SINT16_MAX,
  SINT16_MIN,
  toBytes,
  UINT8_MAX,
} from './bytes';
import type { BleBytes } from './bytes';

// ---------------------------------------------------------------------------------------------
// Indoor Bike Data (0x2AD2)
// ---------------------------------------------------------------------------------------------

/** Every field is optional: a trainer may split one reading across several notifications. */
export interface IndoorBikeData {
  /** Instantaneous speed, km/h (0.01 resolution). Present when flag bit 0 is 0. */
  speedKmh?: number;
  avgSpeedKmh?: number;
  /** Instantaneous cadence, rpm (0.5 resolution). */
  cadenceRpm?: number;
  avgCadenceRpm?: number;
  totalDistanceM?: number;
  /**
   * Resistance level as sent, unitless. GSS defines it as uint8 while FTMS 1.0 used sint16; the
   * parser accepts both (decided by packet length). TODO(spec): scale factor.
   */
  resistanceLevel?: number;
  powerW?: number;
  avgPowerW?: number;
  totalEnergyKcal?: number;
  energyPerHourKcal?: number;
  energyPerMinuteKcal?: number;
  heartRateBpm?: number;
  /** Metabolic equivalent (0.1 resolution). */
  met?: number;
  elapsedSec?: number;
  remainingSec?: number;
}

export const INDOOR_BIKE_FLAG = {
  moreData: 1 << 0,
  avgSpeed: 1 << 1,
  instCadence: 1 << 2,
  avgCadence: 1 << 3,
  totalDistance: 1 << 4,
  resistanceLevel: 1 << 5,
  instPower: 1 << 6,
  avgPower: 1 << 7,
  expendedEnergy: 1 << 8,
  heartRate: 1 << 9,
  metabolicEquivalent: 1 << 10,
  elapsedTime: 1 << 11,
  remainingTime: 1 << 12,
} as const;

/** Field sizes in flag order; resistance level is counted as 2 bytes (FTMS 1.0 sint16). */
const FIELD_SIZES: readonly [flag: number, size: number][] = [
  [INDOOR_BIKE_FLAG.avgSpeed, 2],
  [INDOOR_BIKE_FLAG.instCadence, 2],
  [INDOOR_BIKE_FLAG.avgCadence, 2],
  [INDOOR_BIKE_FLAG.totalDistance, 3],
  [INDOOR_BIKE_FLAG.resistanceLevel, 2],
  [INDOOR_BIKE_FLAG.instPower, 2],
  [INDOOR_BIKE_FLAG.avgPower, 2],
  [INDOOR_BIKE_FLAG.expendedEnergy, 5],
  [INDOOR_BIKE_FLAG.heartRate, 1],
  [INDOOR_BIKE_FLAG.metabolicEquivalent, 1],
  [INDOOR_BIKE_FLAG.elapsedTime, 2],
  [INDOOR_BIKE_FLAG.remainingTime, 2],
];

function expectedLengthWithWideResistance(flags: number): number {
  let length = 2 + ((flags & INDOOR_BIKE_FLAG.moreData) === 0 ? 2 : 0);
  for (const [flag, size] of FIELD_SIZES) if (flags & flag) length += size;
  return length;
}

const has = (flags: number, flag: number): boolean => (flags & flag) !== 0;

export function parseIndoorBikeData(data: BleBytes): IndoorBikeData {
  const r = new ByteReader(data, 'Indoor Bike Data');
  const flags = r.uint16('Flags');
  const out: IndoorBikeData = {};
  // Bit 0 is inverted: 0 means Instantaneous Speed IS present ("More Data" = 1 means it is not).
  if (!has(flags, INDOOR_BIKE_FLAG.moreData)) out.speedKmh = r.uint16('Instantaneous Speed') / 100;
  if (has(flags, INDOOR_BIKE_FLAG.avgSpeed)) out.avgSpeedKmh = r.uint16('Average Speed') / 100;
  if (has(flags, INDOOR_BIKE_FLAG.instCadence)) {
    out.cadenceRpm = r.uint16('Instantaneous Cadence') / 2;
  }
  if (has(flags, INDOOR_BIKE_FLAG.avgCadence)) out.avgCadenceRpm = r.uint16('Average Cadence') / 2;
  if (has(flags, INDOOR_BIKE_FLAG.totalDistance)) out.totalDistanceM = r.uint24('Total Distance');
  if (has(flags, INDOOR_BIKE_FLAG.resistanceLevel)) {
    // GSS: uint8. FTMS 1.0: sint16. A packet exactly one byte shorter than the sint16 layout
    // carries the uint8 form; otherwise read sint16 (a short packet then fails with a clear error).
    const narrow = r.length === expectedLengthWithWideResistance(flags) - 1;
    out.resistanceLevel = narrow ? r.uint8('Resistance Level') : r.sint16('Resistance Level');
  }
  if (has(flags, INDOOR_BIKE_FLAG.instPower)) out.powerW = r.sint16('Instantaneous Power');
  if (has(flags, INDOOR_BIKE_FLAG.avgPower)) out.avgPowerW = r.sint16('Average Power');
  if (has(flags, INDOOR_BIKE_FLAG.expendedEnergy)) {
    out.totalEnergyKcal = r.uint16('Total Energy');
    out.energyPerHourKcal = r.uint16('Energy Per Hour');
    out.energyPerMinuteKcal = r.uint8('Energy Per Minute');
  }
  if (has(flags, INDOOR_BIKE_FLAG.heartRate)) out.heartRateBpm = r.uint8('Heart Rate');
  if (has(flags, INDOOR_BIKE_FLAG.metabolicEquivalent)) {
    out.met = r.uint8('Metabolic Equivalent') / 10;
  }
  if (has(flags, INDOOR_BIKE_FLAG.elapsedTime)) out.elapsedSec = r.uint16('Elapsed Time');
  if (has(flags, INDOOR_BIKE_FLAG.remainingTime)) out.remainingSec = r.uint16('Remaining Time');
  return out;
}

/**
 * Combines split notifications: fields from `next` overwrite `prev`, fields absent from `next`
 * keep their last known value.
 */
export function mergeIndoorBikeData(prev: IndoorBikeData, next: IndoorBikeData): IndoorBikeData {
  return { ...prev, ...next };
}

// ---------------------------------------------------------------------------------------------
// Fitness Machine Feature (0x2ACC)
// ---------------------------------------------------------------------------------------------

/** TODO(spec): bit positions from the research report, not yet checked against the FTMS PDF. */
export const MACHINE_FEATURE_BIT = {
  averageSpeed: 0,
  cadence: 1,
  totalDistance: 2,
  resistanceLevel: 7,
  expendedEnergy: 9,
  heartRate: 10,
  elapsedTime: 12,
  powerMeasurement: 14,
} as const;

/** TODO(spec): bit positions from the research report, not yet checked against the FTMS PDF. */
export const TARGET_SETTING_BIT = {
  speed: 0,
  inclination: 1,
  resistance: 2,
  power: 3,
  heartRate: 4,
  indoorBikeSimulation: 13,
  spinDown: 15,
  targetedCadence: 16,
} as const;

export interface FitnessMachineFeature {
  /** Raw Fitness Machine Features bit field. */
  machineFeatures: number;
  /** Raw Target Setting Features bit field. */
  targetSettingFeatures: number;
  supportsCadence: boolean;
  supportsPowerMeasurement: boolean;
  supportsHeartRate: boolean;
  /** ERG: Set Target Power. */
  supportsTargetPower: boolean;
  supportsResistance: boolean;
  supportsSimulation: boolean;
}

const bit = (value: number, n: number): boolean => ((value >>> n) & 1) === 1;

export function parseFitnessMachineFeature(data: BleBytes): FitnessMachineFeature {
  const r = new ByteReader(data, 'Fitness Machine Feature');
  const machineFeatures = r.uint32('Fitness Machine Features');
  const targetSettingFeatures = r.uint32('Target Setting Features');
  return {
    machineFeatures,
    targetSettingFeatures,
    supportsCadence: bit(machineFeatures, MACHINE_FEATURE_BIT.cadence),
    supportsPowerMeasurement: bit(machineFeatures, MACHINE_FEATURE_BIT.powerMeasurement),
    supportsHeartRate: bit(machineFeatures, MACHINE_FEATURE_BIT.heartRate),
    supportsTargetPower: bit(targetSettingFeatures, TARGET_SETTING_BIT.power),
    supportsResistance: bit(targetSettingFeatures, TARGET_SETTING_BIT.resistance),
    supportsSimulation: bit(targetSettingFeatures, TARGET_SETTING_BIT.indoorBikeSimulation),
  };
}

// ---------------------------------------------------------------------------------------------
// Supported ranges (0x2AD8, 0x2AD6)
// ---------------------------------------------------------------------------------------------

export interface SupportedRange {
  min: number;
  max: number;
  step: number;
}

/** GSS: sint16 min W, sint16 max W, uint16 minimum increment W. */
export function parseSupportedPowerRange(data: BleBytes): SupportedRange {
  const r = new ByteReader(data, 'Supported Power Range');
  return {
    min: r.sint16('Minimum Power'),
    max: r.sint16('Maximum Power'),
    step: r.uint16('Minimum Increment'),
  };
}

/**
 * GSS: three uint8 values (3 bytes). FTMS 1.0: sint16 min, sint16 max, uint16 increment (6 bytes).
 * Both forms are accepted; values are returned as sent. TODO(spec): scale factor.
 */
export function parseSupportedResistanceRange(data: BleBytes): SupportedRange {
  const r = new ByteReader(data, 'Supported Resistance Level Range');
  if (r.length === 3) {
    return {
      min: r.uint8('Minimum Resistance Level'),
      max: r.uint8('Maximum Resistance Level'),
      step: r.uint8('Minimum Increment'),
    };
  }
  return {
    min: r.sint16('Minimum Resistance Level'),
    max: r.sint16('Maximum Resistance Level'),
    step: r.uint16('Minimum Increment'),
  };
}

// ---------------------------------------------------------------------------------------------
// Fitness Machine Control Point (0x2AD9)
// ---------------------------------------------------------------------------------------------

/** TODO(spec): opcodes and parameter formats from the research report (FTMS 1.0 PDF unchecked). */
export const CONTROL_OPCODE = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetResistance: 0x04,
  setTargetPower: 0x05,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  setIndoorBikeSimulation: 0x11,
  responseCode: 0x80,
} as const;

export const STOP_PARAM = { stop: 0x01, pause: 0x02 } as const;

export const RESULT_CODE = {
  success: 0x01,
  notSupported: 0x02,
  invalidParameter: 0x03,
  operationFailed: 0x04,
  controlNotPermitted: 0x05,
} as const;

export type ControlResult = keyof typeof RESULT_CODE | 'unknown';

export function requestControl(): Uint8Array {
  return Uint8Array.of(CONTROL_OPCODE.requestControl);
}

export function reset(): Uint8Array {
  return Uint8Array.of(CONTROL_OPCODE.reset);
}

export function startOrResume(): Uint8Array {
  return Uint8Array.of(CONTROL_OPCODE.startOrResume);
}

export function stopOrPause(kind: 'stop' | 'pause'): Uint8Array {
  return Uint8Array.of(CONTROL_OPCODE.stopOrPause, STOP_PARAM[kind]);
}

/** ERG target in watts: rounded, negative values become 0, capped at sint16 max. */
export function setTargetPower(watts: number): Uint8Array {
  return new ByteWriter()
    .uint8(CONTROL_OPCODE.setTargetPower)
    .sint16(clampInt(watts, 0, SINT16_MAX))
    .toBytes();
}

/**
 * Resistance level in the device's unit (FTMS 1.0: uint8 with 0.1 resolution, so 5 → 50).
 * TODO(spec): parameter type and resolution.
 */
export function setTargetResistance(level: number): Uint8Array {
  return new ByteWriter()
    .uint8(CONTROL_OPCODE.setTargetResistance)
    .uint8(clampInt(level * 10, 0, UINT8_MAX))
    .toBytes();
}

export interface SimulationParams {
  /** Wind speed in m/s (positive = headwind), 0.001 resolution. */
  windMps: number;
  /** Grade in percent, 0.01 resolution. */
  gradePct: number;
  /** Rolling resistance coefficient, 0.0001 resolution. */
  crr: number;
  /** Wind resistance coefficient in kg/m, 0.01 resolution. */
  cwKgPerM: number;
}

/** TODO(spec): field types and resolutions from the research report. */
export function setIndoorBikeSimulation(p: SimulationParams): Uint8Array {
  return new ByteWriter()
    .uint8(CONTROL_OPCODE.setIndoorBikeSimulation)
    .sint16(clampInt(p.windMps * 1000, SINT16_MIN, SINT16_MAX))
    .sint16(clampInt(p.gradePct * 100, SINT16_MIN, SINT16_MAX))
    .uint8(clampInt(p.crr * 10000, 0, UINT8_MAX))
    .uint8(clampInt(p.cwKgPerM * 100, 0, UINT8_MAX))
    .toBytes();
}

export interface ControlPointResponse {
  requestOpcode: number;
  result: ControlResult;
  resultCode: number;
  /** Optional response parameters after the result code. */
  parameters: Uint8Array;
}

const RESULT_BY_CODE = new Map<number, ControlResult>(
  Object.entries(RESULT_CODE).map(([name, code]) => [code, name as ControlResult]),
);

export function parseControlPointResponse(data: BleBytes): ControlPointResponse {
  const r = new ByteReader(data, 'Fitness Machine Control Point response');
  const opcode = r.uint8('Response Op Code');
  if (opcode !== CONTROL_OPCODE.responseCode) {
    throw new BleParseError(
      `Fitness Machine Control Point response: expected op code 0x80, got 0x${opcode.toString(16).padStart(2, '0')}`,
      'Response Op Code',
    );
  }
  const requestOpcode = r.uint8('Request Op Code');
  const resultCode = r.uint8('Result Code');
  return {
    requestOpcode,
    resultCode,
    result: RESULT_BY_CODE.get(resultCode) ?? 'unknown',
    parameters: toBytes(data).slice(r.offset),
  };
}

// ---------------------------------------------------------------------------------------------
// Fitness Machine Status (0x2ADA)
// ---------------------------------------------------------------------------------------------

/** TODO(spec): status op codes from the research report (FTMS 1.0 PDF unchecked). */
export const STATUS_OPCODE = {
  reset: 0x01,
  stoppedOrPaused: 0x02,
  startedOrResumed: 0x04,
  targetResistanceChanged: 0x07,
  targetPowerChanged: 0x08,
  simulationChanged: 0x12,
  controlPermissionLost: 0xff,
} as const;

export type MachineStatus =
  | { kind: 'reset' }
  | { kind: 'stoppedOrPaused'; reason: 'stop' | 'pause' | 'unknown' }
  | { kind: 'startedOrResumed' }
  | { kind: 'targetResistanceChanged'; level: number }
  | { kind: 'targetPowerChanged'; watts: number }
  | { kind: 'simulationChanged'; params: SimulationParams }
  | { kind: 'controlPermissionLost' }
  | { kind: 'unknown'; code: number };

export function parseMachineStatus(data: BleBytes): MachineStatus {
  const r = new ByteReader(data, 'Fitness Machine Status');
  const code = r.uint8('Op Code');
  switch (code) {
    case STATUS_OPCODE.reset:
      return { kind: 'reset' };
    case STATUS_OPCODE.stoppedOrPaused: {
      const param = r.remaining > 0 ? r.uint8('Control Information') : 0;
      const reason =
        param === STOP_PARAM.stop ? 'stop' : param === STOP_PARAM.pause ? 'pause' : 'unknown';
      return { kind: 'stoppedOrPaused', reason };
    }
    case STATUS_OPCODE.startedOrResumed:
      return { kind: 'startedOrResumed' };
    case STATUS_OPCODE.targetResistanceChanged:
      return {
        kind: 'targetResistanceChanged',
        level: r.uint8('New Target Resistance Level') / 10,
      };
    case STATUS_OPCODE.targetPowerChanged:
      return { kind: 'targetPowerChanged', watts: r.sint16('New Target Power') };
    case STATUS_OPCODE.simulationChanged:
      return {
        kind: 'simulationChanged',
        params: {
          windMps: r.sint16('Wind Speed') / 1000,
          gradePct: r.sint16('Grade') / 100,
          crr: r.uint8('Coefficient of Rolling Resistance') / 10000,
          cwKgPerM: r.uint8('Wind Resistance Coefficient') / 100,
        },
      };
    case STATUS_OPCODE.controlPermissionLost:
      return { kind: 'controlPermissionLost' };
    default:
      return { kind: 'unknown', code };
  }
}
