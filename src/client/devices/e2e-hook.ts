/**
 * Test hook for Playwright, loaded only in e2e builds (VITE_E2E=1, see main.tsx): exposes the
 * Bluetooth transport and a fake `navigator.bluetooth` on `window.__hcBle`. Production builds
 * drop the import, so none of this ships to users.
 */

import { FakeHrSensor } from '../../domain/ble/fake-hr';
import { FakeTrainer } from '../../domain/ble/fake-trainer';
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
}

declare global {
  interface Window {
    __hcBle?: BleTestHook;
  }
}

export function installBleTestHook(): void {
  window.__hcBle = {
    FakeTrainer,
    FakeHrSensor,
    createDeviceStore,
    detectBluetoothSupport,
    ftms: { requestControl, startOrResume, setTargetPower, stopOrPause },
    installFake(options) {
      const fake = new FakeBluetooth(options);
      Object.defineProperty(navigator, 'bluetooth', { value: fake, configurable: true });
      return fake;
    },
    removeBluetooth() {
      Object.defineProperty(navigator, 'bluetooth', { value: undefined, configurable: true });
    },
  };
}
