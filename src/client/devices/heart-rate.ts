/** Heart rate strap (Heart Rate Service 0x180D) over a DeviceConnection. */

import { BleParseError } from '../../domain/ble/bytes';
import { parseHeartRateMeasurement, type HeartRateMeasurement } from '../../domain/ble/hrs';
import { CHARACTERISTIC, SERVICE } from '../../domain/ble/uuids';
import { toHex, type BleLog } from './ble-log';
import { createDeviceConnection, type DeviceConnection } from './connection';
import { eventValue, type BleDevice } from './web-bluetooth';

export interface HeartRateReading {
  measurement: HeartRateMeasurement;
  atMs: number;
}

export interface HeartRateStrap {
  readonly connection: DeviceConnection;
  latest(): HeartRateReading | null;
  onReading(listener: (reading: HeartRateReading) => void): () => void;
}

export interface HeartRateStrapOptions {
  device: BleDevice;
  log?: BleLog;
  now?: () => number;
  backoffMs?: readonly number[];
  attemptTimeoutMs?: number;
}

export function createHeartRateStrap(options: HeartRateStrapOptions): HeartRateStrap {
  const { log, now = () => Date.now() } = options;
  const listeners = new Set<(reading: HeartRateReading) => void>();
  let latest: HeartRateReading | null = null;

  const connection = createDeviceConnection({
    device: options.device,
    source: 'hr',
    log,
    backoffMs: options.backoffMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    async setup(server, queue) {
      const service = await queue.run(() => server.getPrimaryService(SERVICE.heartRate));
      const ch = await queue.run(() =>
        service.getCharacteristic(CHARACTERISTIC.heartRateMeasurement),
      );
      latest = null;
      const listener = (event: Event) => {
        const value = eventValue(event);
        if (!value) return;
        try {
          latest = { measurement: parseHeartRateMeasurement(value), atMs: now() };
        } catch (error) {
          if (!(error instanceof BleParseError)) throw error;
          log?.add('hr', 'error', `HRM ${toHex(value)} ${error.message}`);
          return;
        }
        for (const l of listeners) l(latest);
      };
      ch.addEventListener('characteristicvaluechanged', listener);
      try {
        await queue.run(() => ch.startNotifications());
      } catch (error) {
        ch.removeEventListener('characteristicvaluechanged', listener);
        throw error;
      }
      return () => ch.removeEventListener('characteristicvaluechanged', listener);
    },
  });

  return {
    connection,
    latest: () => latest,
    onReading(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
