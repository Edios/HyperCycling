/**
 * Live values for the HUD from the device store: 3 s power, cadence, heart rate and the state of
 * each link. A new snapshot is published only when something visible changes (at most a few per
 * second, driven by notifications and a 1 s staleness check), never from the render loop.
 */

import type { SensorContact } from '../../domain/ble/hrs';
import { createPowerSmoother, STALE_MS } from '../../domain/live-metrics';
import type { DeviceKind, DeviceSlot, DeviceStore } from './device-store';

/**
 * - `off`: no device of this kind (or closed on purpose): the HUD behaves as before.
 * - `live`: data within the last 3 s.
 * - `stale`: connected but silent for more than 3 s (values are missing, not zero).
 * - `reconnecting`: link dropped, trying again.
 * - `lost`: gave up reconnecting.
 */
export type LinkState = 'off' | 'live' | 'stale' | 'reconnecting' | 'lost';

export interface LiveSnapshot {
  trainer: LinkState;
  hr: LinkState;
  /** 3 s average, rounded; null when not live. 0 while the cranks stand still. */
  powerW: number | null;
  cadenceRpm: number | null;
  hrBpm: number | null;
  hrContact: SensorContact | null;
}

export interface LiveMetrics {
  getSnapshot(): LiveSnapshot;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export const OFF_SNAPSHOT: LiveSnapshot = {
  trainer: 'off',
  hr: 'off',
  powerW: null,
  cadenceRpm: null,
  hrBpm: null,
  hrContact: null,
};

function linkState(slot: DeviceSlot, lastAtMs: number | null, nowMs: number): LinkState {
  switch (slot.status) {
    case 'connected':
      return lastAtMs !== null && nowMs - lastAtMs <= STALE_MS ? 'live' : 'stale';
    case 'connecting':
    case 'reconnecting':
      return 'reconnecting';
    case 'disconnected':
      return slot.reason === 'lost' ? 'lost' : 'off';
    default:
      return 'off';
  }
}

const same = (a: LiveSnapshot, b: LiveSnapshot): boolean =>
  a.trainer === b.trainer &&
  a.hr === b.hr &&
  a.powerW === b.powerW &&
  a.cadenceRpm === b.cadenceRpm &&
  a.hrBpm === b.hrBpm &&
  a.hrContact === b.hrContact;

export function createLiveMetrics(
  store: DeviceStore,
  { now = () => Date.now(), tickMs = 1000 }: { now?: () => number; tickMs?: number } = {},
): LiveMetrics {
  const listeners = new Set<() => void>();
  const smoother = createPowerSmoother();
  let snapshot: LiveSnapshot = OFF_SNAPSHOT;
  let trainerAt: number | null = null;
  let hrAt: number | null = null;
  let cadence: number | null = null;
  // Kept apart from trainerAt: a trainer may keep sending power after it stopped sending cadence.
  let cadenceAt: number | null = null;
  let bpm: number | null = null;
  let contact: SensorContact | null = null;
  const unsubscribe: Record<DeviceKind, (() => void) | null> = { trainer: null, hr: null };
  const watched: Record<DeviceKind, unknown> = { trainer: null, hr: null };
  let timer: ReturnType<typeof setInterval> | null = null;

  function publish(): void {
    const t = now();
    const state = store.getState();
    const trainer = linkState(state.trainer, trainerAt, t);
    const hr = linkState(state.hr, hrAt, t);
    const trainerLive = trainer === 'live';
    const power = trainerLive ? smoother.value(t) : null;
    const next: LiveSnapshot = {
      trainer,
      hr,
      // Standing cranks show 0 W rather than a decaying average (report 5.1).
      powerW: power === null ? null : cadence === 0 ? 0 : Math.round(power),
      cadenceRpm:
        trainerLive && cadence !== null && cadenceAt !== null && t - cadenceAt <= STALE_MS
          ? Math.round(cadence)
          : null,
      hrBpm: hr === 'live' && contact !== 'none' ? bpm : null,
      hrContact: hr === 'live' ? contact : null,
    };
    const active = trainer !== 'off' || hr !== 'off';
    if (active && timer === null) timer = setInterval(publish, tickMs);
    if (!active && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (same(next, snapshot)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function follow(): void {
    const trainer = store.trainer();
    if (trainer !== watched.trainer) {
      unsubscribe.trainer?.();
      watched.trainer = trainer;
      smoother.reset();
      trainerAt = null;
      cadence = null;
      cadenceAt = null;
      unsubscribe.trainer =
        trainer?.onData((reading) => {
          trainerAt = reading.atMs;
          // This notification's own fields: a merged value may be old (split packets).
          const { powerW, cadenceRpm } = reading.packet;
          if (powerW !== undefined) smoother.push(powerW, reading.atMs);
          if (cadenceRpm !== undefined) {
            cadence = cadenceRpm;
            cadenceAt = reading.atMs;
          }
          publish();
        }) ?? null;
    }
    const strap = store.hr();
    if (strap !== watched.hr) {
      unsubscribe.hr?.();
      watched.hr = strap;
      hrAt = null;
      bpm = null;
      contact = null;
      unsubscribe.hr =
        strap?.onReading((reading) => {
          hrAt = reading.atMs;
          bpm = reading.measurement.bpm;
          contact = reading.measurement.contact;
          publish();
        }) ?? null;
    }
  }

  const offStore = store.subscribe(() => {
    follow();
    publish();
  });
  follow();
  publish();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      offStore();
      unsubscribe.trainer?.();
      unsubscribe.hr?.();
      if (timer !== null) clearInterval(timer);
      timer = null;
      listeners.clear();
    },
  };
}

const shared = new WeakMap<DeviceStore, LiveMetrics>();

/** One LiveMetrics per device store, created on first use and kept for the page's lifetime. */
export function liveMetricsFor(store: DeviceStore): LiveMetrics {
  let live = shared.get(store);
  if (!live) {
    live = createLiveMetrics(store);
    shared.set(store, live);
  }
  return live;
}
