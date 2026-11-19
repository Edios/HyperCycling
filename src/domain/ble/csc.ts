/**
 * CSC Measurement (0x2A5B) of the Cycling Speed and Cadence Service (0x1816).
 * Source: Bluetooth SIG GSS YAML org.bluetooth.characteristic.csc_measurement.
 */

import { ByteReader } from './bytes';
import type { BleBytes } from './bytes';

export interface CscMeasurement {
  /** Cumulative wheel revolutions (uint32) and last wheel event time in 1/1024 s (uint16). */
  wheel?: { revs: number; eventTime1024: number };
  /** Cumulative crank revolutions (uint16) and last crank event time in 1/1024 s (uint16). */
  crank?: { revs: number; eventTime1024: number };
}

const FLAG = { wheelRevolutionData: 1 << 0, crankRevolutionData: 1 << 1 } as const;

export function parseCscMeasurement(data: BleBytes): CscMeasurement {
  const r = new ByteReader(data, 'CSC Measurement');
  const flags = r.uint8('Flags');
  const out: CscMeasurement = {};
  if (flags & FLAG.wheelRevolutionData) {
    const revs = r.uint32('Cumulative Wheel Revolutions');
    out.wheel = { revs, eventTime1024: r.uint16('Last Wheel Event Time') };
  }
  if (flags & FLAG.crankRevolutionData) {
    const revs = r.uint16('Cumulative Crank Revolutions');
    out.crank = { revs, eventTime1024: r.uint16('Last Crank Event Time') };
  }
  return out;
}
