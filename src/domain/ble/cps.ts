/**
 * Cycling Power Measurement (0x2A63) of the Cycling Power Service (0x1818).
 * Source: Bluetooth SIG GSS YAML org.bluetooth.characteristic.cycling_power_measurement.
 * Only the fields we use are returned; fields between them are skipped by size.
 */

import { ByteReader } from './bytes';
import type { BleBytes } from './bytes';

export interface CyclingPowerMeasurement {
  watts: number;
  /** Pedal power balance in percent (0.5 resolution). */
  balancePct?: number;
  /** Cumulative crank revolutions (uint16) and last crank event time in 1/1024 s (uint16). */
  crank?: { revs: number; eventTime1024: number };
  /** Cumulative wheel revolutions (uint32) and last wheel event time in 1/2048 s (uint16). */
  wheel?: { revs: number; eventTime2048: number };
}

const FLAG = {
  pedalPowerBalance: 1 << 0,
  accumulatedTorque: 1 << 2,
  wheelRevolutionData: 1 << 4,
  crankRevolutionData: 1 << 5,
} as const;

export function parseCyclingPowerMeasurement(data: BleBytes): CyclingPowerMeasurement {
  const r = new ByteReader(data, 'Cycling Power Measurement');
  const flags = r.uint16('Flags');
  const out: CyclingPowerMeasurement = { watts: r.sint16('Instantaneous Power') };
  if (flags & FLAG.pedalPowerBalance) out.balancePct = r.uint8('Pedal Power Balance') / 2;
  if (flags & FLAG.accumulatedTorque) r.skip(2, 'Accumulated Torque');
  if (flags & FLAG.wheelRevolutionData) {
    const revs = r.uint32('Cumulative Wheel Revolutions');
    out.wheel = { revs, eventTime2048: r.uint16('Last Wheel Event Time') };
  }
  if (flags & FLAG.crankRevolutionData) {
    const revs = r.uint16('Cumulative Crank Revolutions');
    out.crank = { revs, eventTime1024: r.uint16('Last Crank Event Time') };
  }
  // Bits 6-12 (forces, torques, angles, energy) follow and are not needed.
  return out;
}
