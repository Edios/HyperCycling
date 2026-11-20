/**
 * FTMS smart trainer over a DeviceConnection: reads Feature and Supported Power Range, enables
 * Control Point indications first (writes fail without them), then Status and Indoor Bike Data
 * notifications. Commands go through the Control Point client; ERG logic itself is T5.
 */

import { BleParseError } from '../../domain/ble/bytes';
import {
  mergeIndoorBikeData,
  parseFitnessMachineFeature,
  parseIndoorBikeData,
  parseMachineStatus,
  parseSupportedPowerRange,
  type ControlPointResponse,
  type FitnessMachineFeature,
  type IndoorBikeData,
  type MachineStatus,
  type SupportedRange,
} from '../../domain/ble/ftms';
import { CHARACTERISTIC, SERVICE } from '../../domain/ble/uuids';
import { toHex, type BleLog } from './ble-log';
import { createDeviceConnection, type DeviceConnection } from './connection';
import { createControlPointClient } from './control-point';
import type { GattQueue } from './gatt-queue';
import {
  eventValue,
  writeWithResponse,
  type BleCharacteristic,
  type BleDevice,
  type BleGattServer,
  type BleService,
} from './web-bluetooth';

export interface TrainerReading {
  /** Last known value of every field, merged across split notifications. */
  data: IndoorBikeData;
  /** Time of the latest notification (from `now`). */
  atMs: number;
}

export interface FtmsTrainer {
  readonly connection: DeviceConnection;
  features(): FitnessMachineFeature | null;
  powerRange(): SupportedRange | null;
  latest(): TrainerReading | null;
  onData(listener: (reading: TrainerReading) => void): () => void;
  onStatus(listener: (status: MachineStatus) => void): () => void;
  /** Writes a Control Point command (from domain/ble/ftms encoders) and waits for its response. */
  command(bytes: Uint8Array): Promise<ControlPointResponse>;
}

export interface FtmsTrainerOptions {
  device: BleDevice;
  log?: BleLog;
  now?: () => number;
  backoffMs?: readonly number[];
  attemptTimeoutMs?: number;
  commandTimeoutMs?: number;
}

export class NotConnectedError extends Error {
  constructor() {
    super('Trainer is not connected');
    this.name = 'NotConnectedError';
  }
}

async function optional<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function listen(ch: BleCharacteristic, handler: (value: DataView) => void): () => void {
  const listener = (event: Event) => {
    const value = eventValue(event);
    if (value) handler(value);
  };
  ch.addEventListener('characteristicvaluechanged', listener);
  return () => ch.removeEventListener('characteristicvaluechanged', listener);
}

export function createFtmsTrainer(options: FtmsTrainerOptions): FtmsTrainer {
  const { log, now = () => Date.now() } = options;
  const dataListeners = new Set<(reading: TrainerReading) => void>();
  const statusListeners = new Set<(status: MachineStatus) => void>();
  let features: FitnessMachineFeature | null = null;
  let powerRange: SupportedRange | null = null;
  let latest: TrainerReading | null = null;
  let controlPoint: BleCharacteristic | null = null;

  const client = createControlPointClient({
    timeoutMs: options.commandTimeoutMs,
    write: (bytes) => {
      const ch = controlPoint;
      if (!ch) return Promise.reject(new NotConnectedError());
      log?.add('trainer', 'tx', `CP ${toHex(bytes)}`);
      return connection.queue.run(() => writeWithResponse(ch, bytes));
    },
    onUnexpected: (data, problem) => log?.add('trainer', 'error', `CP ${toHex(data)} ${problem}`),
  });

  function onIndoorBikeData(value: DataView): void {
    let parsed: IndoorBikeData;
    try {
      parsed = parseIndoorBikeData(value);
    } catch (error) {
      if (!(error instanceof BleParseError)) throw error;
      log?.add('trainer', 'error', `IBD ${toHex(value)} ${error.message}`);
      return;
    }
    latest = { data: mergeIndoorBikeData(latest?.data ?? {}, parsed), atMs: now() };
    for (const listener of dataListeners) listener(latest);
  }

  function onStatus(value: DataView): void {
    log?.add('trainer', 'rx', `Status ${toHex(value)}`);
    let status: MachineStatus;
    try {
      status = parseMachineStatus(value);
    } catch (error) {
      log?.add('trainer', 'error', (error as Error).message);
      return;
    }
    for (const listener of statusListeners) listener(status);
  }

  async function setup(server: BleGattServer, queue: GattQueue): Promise<() => void> {
    const service: BleService = await queue.run(() =>
      server.getPrimaryService(SERVICE.fitnessMachine),
    );
    const char = (uuid: number) => queue.run(() => service.getCharacteristic(uuid));
    const cp = await char(CHARACTERISTIC.fitnessMachineControlPoint);
    const ibd = await char(CHARACTERISTIC.indoorBikeData);
    const status = await optional(char(CHARACTERISTIC.fitnessMachineStatus));

    const featureBytes = await optional(
      char(CHARACTERISTIC.fitnessMachineFeature).then((c) => queue.run(() => c.readValue())),
    );
    features = featureBytes ? parseFitnessMachineFeature(featureBytes) : null;
    const rangeBytes = await optional(
      char(CHARACTERISTIC.supportedPowerRange).then((c) => queue.run(() => c.readValue())),
    );
    powerRange = rangeBytes ? parseSupportedPowerRange(rangeBytes) : null;
    log?.add(
      'trainer',
      'state',
      `features ${featureBytes ? toHex(featureBytes) : '-'} power range ${rangeBytes ? toHex(rangeBytes) : '-'}`,
    );

    // Data from before a reconnect is stale.
    latest = null;
    const removers = [
      listen(cp, (value) => {
        log?.add('trainer', 'rx', `CP ${toHex(value)}`);
        client.handleIndication(value);
      }),
      listen(ibd, onIndoorBikeData),
    ];
    if (status) removers.push(listen(status, onStatus));
    try {
      // Indications on the Control Point first: a write without them ends in an ATT error.
      await queue.run(() => cp.startNotifications());
      if (status) await queue.run(() => status.startNotifications());
      await queue.run(() => ibd.startNotifications());
    } catch (error) {
      for (const remove of removers) remove();
      throw error;
    }
    controlPoint = cp;
    return () => {
      controlPoint = null;
      for (const remove of removers) remove();
    };
  }

  const connection = createDeviceConnection({
    device: options.device,
    setup,
    source: 'trainer',
    log,
    backoffMs: options.backoffMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    onLinkLost: () => client.abort('link lost'),
  });

  return {
    connection,
    features: () => features,
    powerRange: () => powerRange,
    latest: () => latest,
    onData(listener) {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    command: (bytes) => client.send(bytes),
  };
}
