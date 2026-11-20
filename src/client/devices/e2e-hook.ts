/**
 * Test hook for Playwright, loaded only in e2e builds (VITE_E2E=1, see main.tsx): exposes the
 * Bluetooth transport and a fake `navigator.bluetooth` on `window.__hcBle`. Production builds
 * drop the import, so none of this ships to users.
 */

import { FakeHrSensor } from '../../domain/ble/fake-hr';
import { FakeTrainer, type FakeTrainerOptions } from '../../domain/ble/fake-trainer';
import { requestControl, setTargetPower, startOrResume, stopOrPause } from '../../domain/ble/ftms';
import { createDeviceStore } from './device-store';
import { FakeBluetooth, type FakeBluetoothOptions } from './fake-bluetooth';
import { detectBluetoothSupport } from './support';

export interface BleTestHook {
  FakeTrainer: typeof FakeTrainer;
  FakeHrSensor: typeof FakeHrSensor;
  createDeviceStore: typeof createDeviceStore;
  detectBluetoothSupport: typeof detectBluetoothSupport;
  ftms: {
    requestControl: typeof requestControl;
    startOrResume: typeof startOrResume;
    setTargetPower: typeof setTargetPower;
    stopOrPause: typeof stopOrPause;
  };
  /** Replaces `navigator.bluetooth` with a fake and returns it. */
  installFake(options?: FakeBluetoothOptions): FakeBluetooth;
  /** Removes `navigator.bluetooth` (an unsupported browser). */
  removeBluetooth(): void;
  /** The fake installed last (also by the localStorage switch below). */
  fake?: FakeBluetooth;
}

/**
 * Set this localStorage key (JSON: `{ trainer?: FakeTrainerOptions, hrBpm?: number }`) before the
 * page loads and the fake is installed before the app renders, also after a full reload (e.g. the
 * Spotify sign-in redirect).
 */
export const FAKE_BLUETOOTH_KEY = 'hypercycling.e2e.fakeBluetooth';

declare global {
  interface Window {
    __hcBle?: BleTestHook;
  }
}

export function installBleTestHook(): void {
  const hook: BleTestHook = {
    FakeTrainer,
    FakeHrSensor,
    createDeviceStore,
    detectBluetoothSupport,
    ftms: { requestControl, startOrResume, setTargetPower, stopOrPause },
    installFake(options) {
      const fake = new FakeBluetooth(options);
      Object.defineProperty(navigator, 'bluetooth', { value: fake, configurable: true });
      hook.fake = fake;
      return fake;
    },
    removeBluetooth() {
      Object.defineProperty(navigator, 'bluetooth', { value: undefined, configurable: true });
    },
  };
  window.__hcBle = hook;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(FAKE_BLUETOOTH_KEY);
  } catch {
    // storage blocked: no automatic fake
  }
  if (stored) {
    const config = JSON.parse(stored) as { trainer?: FakeTrainerOptions; hrBpm?: number };
    const bpm = config.hrBpm ?? 120;
    hook.installFake({
      trainer: new FakeTrainer(config.trainer),
      hr: new FakeHrSensor({ bpm: () => bpm }),
    });
  }
}
