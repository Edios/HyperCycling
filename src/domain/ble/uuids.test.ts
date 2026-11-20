import { describe, expect, it } from 'vitest';
import { CHARACTERISTIC, fullUuid, SERVICE } from './uuids';

describe('uuids', () => {
  it('lists the assigned numbers used by the trainer and sensors', () => {
    expect(SERVICE.fitnessMachine).toBe(0x1826);
    expect(CHARACTERISTIC.indoorBikeData).toBe(0x2ad2);
    expect(CHARACTERISTIC.fitnessMachineControlPoint).toBe(0x2ad9);
    expect(CHARACTERISTIC.heartRateMeasurement).toBe(0x2a37);
  });

  it('expands a 16-bit number with the Bluetooth Base UUID', () => {
    expect(fullUuid(SERVICE.heartRate)).toBe('0000180d-0000-1000-8000-00805f9b34fb');
    expect(fullUuid(0x2a)).toBe('0000002a-0000-1000-8000-00805f9b34fb');
  });
});
