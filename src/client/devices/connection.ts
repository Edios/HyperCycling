/**
 * Connection life cycle of one Bluetooth device: connect, set up services and notifications,
 * and when the link drops on its own, reconnect with a growing delay (1, 2, 4, 8, 15 s, about
 * 30 s in total) before giving up. After a drop every service and characteristic object is stale,
 * so `setup` runs again on each reconnect (research report, sections 2.2 and 5.1).
 */

import type { BleLog, BleLogSource } from './ble-log';
import { createGattQueue, type GattQueue } from './gatt-queue';
import type { BleDevice, BleGattServer } from './web-bluetooth';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type DisconnectReason = 'user' | 'lost' | 'failed';

export interface ConnectionStatus {
  state: ConnectionState;
  /** Set in 'disconnected': closed by the app, link lost for good, or the first connect failed. */
  reason?: DisconnectReason;
  /** Reconnect attempt number while 'reconnecting' (1-based). */
  attempt?: number;
}

/** Subscribes to the device and returns a teardown that removes the listeners. */
export type DeviceSetup = (server: BleGattServer, queue: GattQueue) => Promise<() => void>;

export interface DeviceConnectionOptions {
  device: BleDevice;
  setup: DeviceSetup;
  source: BleLogSource;
  log?: BleLog;
  backoffMs?: readonly number[];
  /** A connect plus setup that takes longer than this counts as failed. */
  attemptTimeoutMs?: number;
  /** A single GATT operation that takes longer than this is given up. */
  opTimeoutMs?: number;
  /** Called after the link dropped, before reconnecting (abort pending commands here). */
  onLinkLost?(): void;
}

export interface DeviceConnection {
  readonly device: BleDevice;
  readonly queue: GattQueue;
  status(): ConnectionStatus;
  subscribe(listener: (status: ConnectionStatus) => void): () => void;
  /** First connection; rejects (and ends in 'disconnected'/'failed') when it does not work. */
  connect(): Promise<void>;
  /** Closes the link on purpose: no reconnect. */
  disconnect(): void;
  /** Starts a new reconnect cycle after giving up (e.g. a "Reconnect" button). */
  reconnect(): Promise<void>;
  /** Closes the link and removes every listener from the device object (the device is forgotten). */
  dispose(): void;
}

export const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;

class AttemptTimeoutError extends Error {
  constructor(ms: number) {
    super(`connect timed out after ${ms} ms`);
    this.name = 'AttemptTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AttemptTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createDeviceConnection({
  device,
  setup,
  source,
  log,
  backoffMs = DEFAULT_BACKOFF_MS,
  attemptTimeoutMs = 10_000,
  opTimeoutMs,
  onLinkLost,
}: DeviceConnectionOptions): DeviceConnection {
  const queue = createGattQueue({ opTimeoutMs });
  const listeners = new Set<(status: ConnectionStatus) => void>();
  let current: ConnectionStatus = { state: 'disconnected' };
  let teardown: (() => void) | null = null;
  /** Bumped on every connect/disconnect decision; stale async work checks it and stops. */
  let epoch = 0;

  function set(status: ConnectionStatus): void {
    current = status;
    log?.add(
      source,
      'state',
      [status.state, status.reason, status.attempt].filter(Boolean).join(' '),
    );
    for (const listener of listeners) listener(status);
  }

  function dropSubscriptions(): void {
    teardown?.();
    teardown = null;
    queue.clear('link closed');
  }

  async function open(myEpoch: number): Promise<void> {
    const gatt = device.gatt;
    if (!gatt) throw new Error('device has no GATT server');
    let abandoned = false;
    const attempt = async () => {
      const server = await gatt.connect();
      const remove = await setup(server, queue);
      if (abandoned || myEpoch !== epoch) {
        remove();
        return;
      }
      teardown = remove;
    };
    try {
      await withTimeout(attempt(), attemptTimeoutMs);
    } catch (error) {
      abandoned = true;
      dropSubscriptions();
      if (gatt.connected) gatt.disconnect();
      throw error;
    }
  }

  async function reconnectLoop(myEpoch: number, delays: readonly number[]): Promise<void> {
    for (let i = 0; i < delays.length; i++) {
      set({ state: 'reconnecting', attempt: i + 1 });
      await sleep(delays[i] ?? 0);
      if (myEpoch !== epoch) return;
      try {
        await open(myEpoch);
        if (myEpoch !== epoch) return;
        set({ state: 'connected' });
        return;
      } catch (error) {
        if (myEpoch !== epoch) return;
        log?.add(source, 'error', `reconnect ${i + 1} failed: ${(error as Error).message}`);
      }
    }
    set({ state: 'disconnected', reason: 'lost' });
  }

  function onDisconnected(): void {
    // Our own disconnect() and drops during a connect attempt are handled where they happen.
    if (current.state !== 'connected') return;
    log?.add(source, 'state', 'link lost');
    dropSubscriptions();
    onLinkLost?.();
    epoch += 1;
    void reconnectLoop(epoch, backoffMs);
  }

  device.addEventListener('gattserverdisconnected', onDisconnected);

  return {
    device,
    queue,
    status: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async connect() {
      epoch += 1;
      const myEpoch = epoch;
      set({ state: 'connecting' });
      try {
        await open(myEpoch);
      } catch (error) {
        if (myEpoch === epoch) set({ state: 'disconnected', reason: 'failed' });
        throw error;
      }
      if (myEpoch === epoch) set({ state: 'connected' });
    },
    disconnect() {
      epoch += 1;
      dropSubscriptions();
      onLinkLost?.();
      set({ state: 'disconnected', reason: 'user' });
      if (device.gatt?.connected) device.gatt.disconnect();
    },
    dispose() {
      epoch += 1;
      listeners.clear();
      device.removeEventListener('gattserverdisconnected', onDisconnected);
      dropSubscriptions();
      onLinkLost?.();
      current = { state: 'disconnected', reason: 'user' };
      if (device.gatt?.connected) device.gatt.disconnect();
    },
    async reconnect() {
      if (current.state === 'connected' || current.state === 'reconnecting') return;
      epoch += 1;
      // A manual retry tries at once, then falls back to the usual backoff.
      await reconnectLoop(epoch, [0, ...backoffMs]);
    },
  };
}
