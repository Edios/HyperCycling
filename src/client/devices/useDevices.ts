import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { sharedDeviceStore, type DeviceStore, type DevicesState } from './device-store';
import type { HeartRateReading } from './heart-rate';
import { isAdapterAvailable } from './support';
import type { TrainerReading } from './trainer';

/** Tests and the e2e hook may provide their own store; the app uses the shared one. */
export const DeviceStoreContext = createContext<DeviceStore | null>(null);

export function useDeviceStore(): DeviceStore {
  return useContext(DeviceStoreContext) ?? sharedDeviceStore();
}

export function useDevicesState(store: DeviceStore): DevicesState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Latest trainer reading; follows the trainer object when a new one is chosen. */
export function useTrainerReading(store: DeviceStore, state: DevicesState): TrainerReading | null {
  const trainer = state.trainer.status === 'none' ? null : store.trainer();
  const [reading, setReading] = useState<TrainerReading | null>(() => trainer?.latest() ?? null);
  useEffect(() => {
    setReading(trainer?.latest() ?? null);
    return trainer?.onData(setReading);
  }, [trainer]);
  return state.trainer.status === 'connected' ? reading : null;
}

export function useHeartRateReading(
  store: DeviceStore,
  state: DevicesState,
): HeartRateReading | null {
  const strap = state.hr.status === 'none' ? null : store.hr();
  const [reading, setReading] = useState<HeartRateReading | null>(() => strap?.latest() ?? null);
  useEffect(() => {
    setReading(strap?.latest() ?? null);
    return strap?.onReading(setReading);
  }, [strap]);
  return state.hr.status === 'connected' ? reading : null;
}

/** False only when the engine says there is no adapter (taken as a warning, not a block). */
export function useAdapterAvailable(store: DeviceStore, supported: boolean): boolean {
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    const bluetooth = store.bluetooth;
    if (!supported || !bluetooth) return;
    let alive = true;
    void isAdapterAvailable(bluetooth).then((v) => alive && setAvailable(v));
    return () => {
      alive = false;
    };
  }, [store, supported]);
  return available;
}
