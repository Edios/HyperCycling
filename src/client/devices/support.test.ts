import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { pl } from '../i18n/pl';
import { createBleLog, toHex } from './ble-log';
import {
  detectBluetoothSupport,
  isAdapterAvailable,
  UNSUPPORTED_MESSAGE,
  type SupportEnv,
} from './support';
import type { BluetoothLike } from './web-bluetooth';

const UA = {
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  chromeLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
};

const bt: BluetoothLike = { requestDevice: () => Promise.reject(new Error('unused')) };
const env = (over: Partial<SupportEnv>): SupportEnv => ({
  bluetooth: undefined,
  userAgent: UA.chromeWin,
  maxTouchPoints: 0,
  secureContext: true,
  ...over,
});

describe('detectBluetoothSupport', () => {
  it('is supported whenever the API exists (also Bluefy on iOS)', () => {
    expect(detectBluetoothSupport(env({ bluetooth: bt }))).toEqual({
      supported: true,
      bluetooth: bt,
    });
    expect(detectBluetoothSupport(env({ bluetooth: bt, userAgent: UA.iphone })).supported).toBe(
      true,
    );
  });

  it.each([
    ['insecure-context', env({ secureContext: false })],
    ['ios', env({ userAgent: UA.iphone })],
    ['ios', env({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 })],
    ['safari', env({ userAgent: UA.ipadDesktop })],
    ['firefox', env({ userAgent: UA.firefox })],
    ['no-api', env({ userAgent: UA.chromeLinux })],
    ['no-api', env({ userAgent: UA.edge })],
  ])('reason %s', (reason, e) => {
    expect(detectBluetoothSupport(e)).toEqual({ supported: false, reason });
  });

  it('reads the current browser by default (jsdom has no Bluetooth)', () => {
    expect(detectBluetoothSupport().supported).toBe(false);
  });

  it('every reason has a message in both languages', () => {
    for (const key of Object.values(UNSUPPORTED_MESSAGE)) {
      const [, , leaf] = key.split('.') as [string, string, keyof typeof en.devices.unsupported];
      expect(en.devices.unsupported[leaf]).toBeTruthy();
      expect(pl.devices.unsupported[leaf]).toBeTruthy();
    }
  });
});

describe('isAdapterAvailable', () => {
  it('asks the engine, assumes yes when it cannot tell and no when it throws', async () => {
    await expect(isAdapterAvailable(bt)).resolves.toBe(true);
    await expect(isAdapterAvailable({ ...bt, getAvailability: async () => false })).resolves.toBe(
      false,
    );
    await expect(
      isAdapterAvailable({ ...bt, getAvailability: () => Promise.reject(new Error('x')) }),
    ).resolves.toBe(false);
  });
});

describe('ble log', () => {
  it('keeps the newest entries up to the limit and prints them', () => {
    let t = Date.UTC(2026, 10, 20, 8, 0, 0);
    const log = createBleLog({ limit: 2, now: () => t++ });
    log.add('trainer', 'tx', 'CP 00');
    log.add('trainer', 'rx', 'CP 80 00 01');
    log.add('hr', 'state', 'connected');
    expect(log.entries().map((e) => e.text)).toEqual(['CP 80 00 01', 'connected']);
    expect(log.toText()).toBe(
      '2026-11-20T08:00:00.001Z trainer rx CP 80 00 01\n2026-11-20T08:00:00.002Z hr state connected',
    );
    log.clear();
    expect(log.entries()).toEqual([]);
  });

  it('formats bytes from buffers, views and offsets', () => {
    const backing = Uint8Array.of(0xff, 0x05, 0xc8, 0x00);
    expect(toHex(backing.subarray(1))).toBe('05 C8 00');
    expect(toHex(new DataView(backing.buffer, 1, 2))).toBe('05 C8');
    expect(toHex(backing.buffer)).toBe('FF 05 C8 00');
  });
});
