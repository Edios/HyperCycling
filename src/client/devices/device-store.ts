/**
 * App-wide state of the trainer and heart rate strap, shaped for `useSyncExternalStore` (the UI
 * comes in T3). Holds the screen awake while any device is connected or reconnecting: Android
 * may suspend a page with the screen off, and ERG needs the page alive (report, section 2.3).
 */

import { SERVICE } from '../../domain/ble/uuids';
import { createWakeLock, type WakeLockController } from '../training/wake-lock';
import { createBleLog, type BleLog } from './ble-log';
import type { ConnectionStatus, DeviceConnection, DisconnectReason } from './connection';
import { createHeartRateStrap, type HeartRateStrap } from './heart-rate';
import { detectBluetoothSupport, type BluetoothSupport, type UnsupportedReason } from './support';
import { createFtmsTrainer, type FtmsTrainer } from './trainer';
import type { BleRequestOptions, BluetoothLike } from './web-bluetooth';

export type DeviceKind = 'trainer' | 'hr';

export interface DeviceSlot {
  status: 'none' | ConnectionStatus['state'];
  reason?: DisconnectReason;
  attempt?: number;
  name?: string;
  /** Technical error text for diagnostics (not shown to the user as is). */
  error?: string;
}

export interface DevicesState {
  supported: boolean;
  unsupportedReason?: UnsupportedReason;
  trainer: DeviceSlot;
  hr: DeviceSlot;
}

export type ConnectOutcome = 'connected' | 'cancelled' | 'failed' | 'unsupported';

export interface DeviceStore {
  getState(): DevicesState;
  subscribe(listener: () => void): () => void;
  /** Opens the browser's device chooser; call it from a click or tap handler. */
  connect(kind: DeviceKind): Promise<ConnectOutcome>;
  disconnect(kind: DeviceKind): void;
  /** Retries a device that gave up reconnecting, without the chooser. */
  reconnect(kind: DeviceKind): Promise<void>;
  trainer(): FtmsTrainer | null;
  hr(): HeartRateStrap | null;
  readonly log: BleLog;
  /** The Web Bluetooth object in use, or null in an unsupported browser. */
  readonly bluetooth: BluetoothLike | null;
}

export interface DeviceStoreOptions {
  support?: BluetoothSupport;
  log?: BleLog;
  wakeLock?: WakeLockController;
  now?: () => number;
  backoffMs?: readonly number[];
  attemptTimeoutMs?: number;
  commandTimeoutMs?: number;
}

/** Chooser filters: the trainer by FTMS; other services we may read later must be listed now. */
export const REQUEST_OPTIONS: Record<DeviceKind, BleRequestOptions> = {
  trainer: {
    filters: [{ services: [SERVICE.fitnessMachine] }],
    // Listed now because the browser grants only these at pairing time. Heart Rate: some
    // trainers (e.g. hubs that relay a strap) expose it as a separate service.
    optionalServices: [
      SERVICE.cyclingPower,
      SERVICE.cyclingSpeedCadence,
      SERVICE.heartRate,
      SERVICE.deviceInformation,
      SERVICE.battery,
    ],
  },
  hr: {
    filters: [{ services: [SERVICE.heartRate] }],
    optionalServices: [SERVICE.deviceInformation, SERVICE.battery],
  },
};

const ACTIVE = new Set<DeviceSlot['status']>(['connecting', 'connected', 'reconnecting']);

export function createDeviceStore(options: DeviceStoreOptions = {}): DeviceStore {
  const support = options.support ?? detectBluetoothSupport();
  const log = options.log ?? createBleLog({ now: options.now });
  const wakeLock = options.wakeLock ?? createWakeLock();
  const listeners = new Set<() => void>();
  const devices: { trainer: FtmsTrainer | null; hr: HeartRateStrap | null } = {
    trainer: null,
    hr: null,
  };
  const unsubscribe: Record<DeviceKind, (() => void) | null> = { trainer: null, hr: null };
  let state: DevicesState = {
    supported: support.supported,
    ...(support.supported ? {} : { unsupportedReason: support.reason }),
    trainer: { status: 'none' },
    hr: { status: 'none' },
  };
  let wakeHeld = false;

  function update(kind: DeviceKind, slot: DeviceSlot): void {
    state = { ...state, [kind]: slot };
    const active = ACTIVE.has(state.trainer.status) || ACTIVE.has(state.hr.status);
    if (active !== wakeHeld) {
      wakeHeld = active;
      void (active ? wakeLock.acquire() : wakeLock.release());
    }
    for (const listener of listeners) listener();
  }

  function connectionOf(kind: DeviceKind): DeviceConnection | null {
    return devices[kind]?.connection ?? null;
  }

  function forget(kind: DeviceKind): void {
    unsubscribe[kind]?.();
    unsubscribe[kind] = null;
    connectionOf(kind)?.dispose();
    devices[kind] = null;
  }

  return {
    log,
    bluetooth: support.supported ? support.bluetooth : null,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    trainer: () => devices.trainer,
    hr: () => devices.hr,

    async connect(kind) {
      if (!support.supported) return 'unsupported';
      let device;
      try {
        device = await support.bluetooth.requestDevice(REQUEST_OPTIONS[kind]);
      } catch (error) {
        // NotFoundError: the user closed the chooser without picking a device.
        if ((error as Error).name === 'NotFoundError') return 'cancelled';
        log.add('app', 'error', `requestDevice ${kind}: ${(error as Error).message}`);
        update(kind, { status: 'disconnected', reason: 'failed', error: (error as Error).message });
        return 'failed';
      }
      forget(kind);
      const name = device.name ?? undefined;
      const common = {
        device,
        log,
        now: options.now,
        backoffMs: options.backoffMs,
        attemptTimeoutMs: options.attemptTimeoutMs,
      };
      const created =
        kind === 'trainer'
          ? (devices.trainer = createFtmsTrainer({
              ...common,
              commandTimeoutMs: options.commandTimeoutMs,
            }))
          : (devices.hr = createHeartRateStrap(common));
      unsubscribe[kind] = created.connection.subscribe((s) =>
        update(kind, { status: s.state, reason: s.reason, attempt: s.attempt, name }),
      );
      try {
        await created.connection.connect();
        return 'connected';
      } catch (error) {
        log.add(kind, 'error', `connect: ${(error as Error).message}`);
        update(kind, { ...state[kind], error: (error as Error).message });
        return 'failed';
      }
    },

    disconnect(kind) {
      const connection = connectionOf(kind);
      if (!connection) return;
      connection.disconnect();
    },

    async reconnect(kind) {
      await connectionOf(kind)?.reconnect();
    },
  };
}

let shared: DeviceStore | null = null;

/** The app's single store, created on first use. */
export function sharedDeviceStore(): DeviceStore {
  shared ??= createDeviceStore();
  return shared;
}
