/**
 * Heart Rate Measurement (0x2A37) of the Heart Rate Service (0x180D).
 * Source: Bluetooth SIG GSS YAML org.bluetooth.characteristic.heart_rate_measurement.
 */

import { ByteReader } from './bytes';
import type { BleBytes } from './bytes';

export type SensorContact = 'unsupported' | 'none' | 'ok';

export interface HeartRateMeasurement {
  bpm: number;
  contact: SensorContact;
  /** Energy Expended since the last reset. TODO(spec): GSS says "joule", HRS 1.0 says kJ. */
  energyKj?: number;
  /** RR intervals in ms, oldest first (sent in 1/1024 s). */
  rrMs: number[];
}

const FLAG = {
  uint16Value: 1 << 0,
  contactDetected: 1 << 1,
  contactSupported: 1 << 2,
  energyExpended: 1 << 3,
  rrInterval: 1 << 4,
} as const;

function contactOf(flags: number): SensorContact {
  if ((flags & FLAG.contactSupported) === 0) return 'unsupported';
  return (flags & FLAG.contactDetected) !== 0 ? 'ok' : 'none';
}

export function parseHeartRateMeasurement(data: BleBytes): HeartRateMeasurement {
  const r = new ByteReader(data, 'Heart Rate Measurement');
  const flags = r.uint8('Flags');
  const bpm =
    flags & FLAG.uint16Value
      ? r.uint16('Heart Rate Measurement Value (uint16)')
      : r.uint8('Heart Rate Measurement Value (uint8)');
  const out: HeartRateMeasurement = { bpm, contact: contactOf(flags), rrMs: [] };
  if (flags & FLAG.energyExpended) out.energyKj = r.uint16('Energy Expended');
  if (flags & FLAG.rrInterval) {
    // RR-Interval is uint16[n]: read pairs until the packet ends.
    while (r.remaining >= 2) out.rrMs.push((r.uint16('RR-Interval') * 1000) / 1024);
  }
  return out;
}
