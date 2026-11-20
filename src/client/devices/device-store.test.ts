import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHrSensor } from '../../domain/ble/fake-hr';
import { FakeTrainer } from '../../domain/ble/fake-trainer';
import {
  requestControl,
  setTargetPower,
  startOrResume,
  type MachineStatus,
} from '../../domain/ble/ftms';
import { CHARACTERISTIC } from '../../domain/ble/uuids';
import { ControlPointAbortedError, ControlPointTimeoutError } from './control-point';
import { createDeviceStore, REQUEST_OPTIONS, type DeviceStore } from './device-store';
import { FakeBluetooth } from './fake-bluetooth';
import { NotConnectedError } from './trainer';
import type { BleCharacteristic } from './web-bluetooth';

function setup(fakeOptions: ConstructorParameters<typeof FakeBluetooth>[0] = {}) {
  const bluetooth = new FakeBluetooth(fakeOptions);
  const wakeLock = { acquire: vi.fn(async () => {}), release: vi.fn(async () => {}) };
  const store = createDeviceStore({
    support: { supported: true, bluetooth },
    wakeLock,
    now: () => Date.now(),
  });
  return { bluetooth, wakeLock, store };
}

/** Pumps the simulator at 1 Hz for `seconds`, advancing fake time. */
async function ride(bluetooth: FakeBluetooth, seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await vi.advanceTimersByTimeAsync(1000);
    bluetooth.pump(Date.now());
  }
}

async function erg(store: DeviceStore, watts: number) {
  const trainer = store.trainer()!;
  const results = [];
  for (const command of [requestControl(), startOrResume(), setTargetPower(watts)]) {
    const pending = trainer.command(command);
    await vi.advanceTimersByTimeAsync(0);
    results.push((await pending).result);
  }
  return results;
}

describe('device store with the fake Bluetooth', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('connects the trainer, reads its capabilities and holds a wake lock', async () => {
    const { store, wakeLock } = setup();
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getState().trainer.status));
    await expect(store.connect('trainer')).resolves.toBe('connected');
    expect(seen).toEqual(['connecting', 'connected']);
    expect(store.getState().trainer).toMatchObject({
      status: 'connected',
      name: 'Fake Trainer 0001',
    });
    expect(store.trainer()!.features()).toMatchObject({ supportsTargetPower: true });
    expect(store.trainer()!.powerRange()).toEqual({ min: 0, max: 1500, step: 1 });
    expect(wakeLock.acquire).toHaveBeenCalledTimes(1);
    expect(store.log.toText()).toContain('features 02 40 00 00 0C 20 00 00');
  });

  it('runs Request Control → Start → 200 W and the data reaches ±5 % within 6 s', async () => {
    const { store, bluetooth } = setup({ trainer: new FakeTrainer({ seed: 3 }) });
    await store.connect('trainer');
    const statuses: MachineStatus[] = [];
    store.trainer()!.onStatus((s) => statuses.push(s));
    await ride(bluetooth, 10); // free ride warm-up
    expect(await erg(store, 200)).toEqual(['success', 'success', 'success']);
    expect(statuses).toContainEqual({ kind: 'targetPowerChanged', watts: 200 });
    const readings: number[] = [];
    store.trainer()!.onData((r) => readings.push(r.data.powerW ?? 0));
    await ride(bluetooth, 6);
    const last = readings.at(-1)!;
    expect(last).toBeGreaterThanOrEqual(190);
    expect(last).toBeLessThanOrEqual(210);
    expect(store.trainer()!.latest()).toMatchObject({ data: { cadenceRpm: 90 }, atMs: Date.now() });
    expect(bluetooth.writes.map((w) => w.bytes[0])).toEqual([0x00, 0x07, 0x05]);
  });

  it('merges split Indoor Bike Data packets', async () => {
    const { store, bluetooth } = setup({ trainer: new FakeTrainer({ splitPackets: true }) });
    await store.connect('trainer');
    await ride(bluetooth, 1);
    expect(Object.keys(store.trainer()!.latest()!.data).sort()).toEqual([
      'cadenceRpm',
      'elapsedSec',
      'powerW',
      'speedKmh',
    ]);
  });

  it('a Control Point write without indications fails like on hardware', async () => {
    const { bluetooth } = setup();
    const gatt = await bluetooth.devices.trainer.gatt.connect();
    const service = await gatt.getPrimaryService(0x1826);
    const cp: BleCharacteristic = await service.getCharacteristic(
      CHARACTERISTIC.fitnessMachineControlPoint,
    );
    await expect(cp.writeValue(requestControl().buffer as ArrayBuffer)).rejects.toThrow(
      /indications are not enabled/,
    );
  });

  it('times out after one retry when the trainer stays silent', async () => {
    const { store, bluetooth } = setup();
    await store.connect('trainer');
    bluetooth.trainer.faults = { dropResponses: true };
    const caught = store
      .trainer()!
      .command(requestControl())
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await caught).toBeInstanceOf(ControlPointTimeoutError);
    expect(bluetooth.writes).toHaveLength(2);
  });

  it('reports lost control (status 0xFF)', async () => {
    const { store, bluetooth } = setup();
    await store.connect('trainer');
    const statuses: MachineStatus[] = [];
    store.trainer()!.onStatus((s) => statuses.push(s));
    await erg(store, 150);
    bluetooth.takeControlAway();
    expect(statuses.at(-1)).toEqual({ kind: 'controlPermissionLost' });
  });

  it('logs malformed packets instead of throwing', async () => {
    const { store, bluetooth } = setup();
    await store.connect('trainer');
    await store.connect('hr');
    bluetooth.devices.trainer.gatt.emit(CHARACTERISTIC.indoorBikeData, Uint8Array.of(0x41, 0x00));
    bluetooth.devices.trainer.gatt.emit(CHARACTERISTIC.fitnessMachineStatus, new Uint8Array(0));
    bluetooth.devices.trainer.gatt.emit(
      CHARACTERISTIC.fitnessMachineControlPoint,
      Uint8Array.of(0x80),
    );
    bluetooth.devices.hr.gatt.emit(CHARACTERISTIC.heartRateMeasurement, Uint8Array.of(0x01, 0x50));
    const text = store.log.toText();
    expect(text).toContain(
      'IBD 41 00 Indoor Bike Data: packet too short for "Instantaneous Power"',
    );
    expect(text).toContain('Fitness Machine Status: packet too short for "Op Code"');
    expect(text).toContain('CP 80 Fitness Machine Control Point response');
    expect(text).toContain('HRM 01 50 Heart Rate Measurement');
    expect(store.trainer()!.latest()).toBeNull();
  });

  it('reconnects after a link drop: commands in flight fail, data and indications come back', async () => {
    const { store, bluetooth } = setup({ responseDelayMs: 500 });
    await store.connect('trainer');
    await ride(bluetooth, 1);
    expect(store.trainer()!.latest()).not.toBeNull();
    const pending = store
      .trainer()!
      .command(requestControl())
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    bluetooth.dropLink('trainer');
    expect(await pending).toBeInstanceOf(ControlPointAbortedError);
    expect(store.getState().trainer).toMatchObject({ status: 'reconnecting', attempt: 1 });
    expect(store.trainer()!.latest()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().trainer.status).toBe('connected');
    expect(store.trainer()!.latest()).toBeNull(); // stale data dropped
    await ride(bluetooth, 1);
    expect(store.trainer()!.latest()!.data.cadenceRpm).toBe(90);
    // Control was lost with the link: the trainer answers 0x05 until Request Control.
    const answer = store.trainer()!.command(setTargetPower(200));
    await vi.advanceTimersByTimeAsync(500);
    expect((await answer).result).toBe('controlNotPermitted');
  });

  it('backs off 1, 2, 4, 8, 15 s, then gives up; a manual reconnect works once in range', async () => {
    const { store, bluetooth, wakeLock } = setup();
    await store.connect('trainer');
    bluetooth.dropLink('trainer', { stayAway: true });
    const attempts: number[] = [];
    store.subscribe(() => {
      const a = store.getState().trainer.attempt;
      if (a && attempts.at(-1) !== a) attempts.push(a);
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(store.getState().trainer.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getState().trainer).toMatchObject({ status: 'disconnected', reason: 'lost' });
    expect(attempts).toEqual([2, 3, 4, 5]);
    expect(wakeLock.release).toHaveBeenCalledTimes(1);
    expect(store.log.toText()).toContain(
      'reconnect 5 failed: Bluetooth Device is no longer in range.',
    );

    bluetooth.restoreLink('trainer');
    const manual = store.reconnect('trainer');
    await vi.advanceTimersByTimeAsync(0);
    await manual;
    expect(store.getState().trainer.status).toBe('connected');
    expect(wakeLock.acquire).toHaveBeenCalledTimes(2);
    await store.reconnect('trainer'); // already connected: no-op
  });

  it('a hung connect counts as failed after the attempt timeout', async () => {
    const { store, bluetooth } = setup();
    await store.connect('trainer');
    bluetooth.hangConnects('trainer', 1);
    bluetooth.dropLink('trainer');
    await vi.advanceTimersByTimeAsync(1000 + 10_000);
    expect(store.log.toText()).toContain('reconnect 1 failed: connect timed out after 10000 ms');
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getState().trainer.status).toBe('connected');
  });

  it('a failed first connection ends in disconnected/failed', async () => {
    const { store, bluetooth, wakeLock } = setup();
    bluetooth.failConnects('trainer', 1);
    await expect(store.connect('trainer')).resolves.toBe('failed');
    expect(store.getState().trainer).toMatchObject({
      status: 'disconnected',
      reason: 'failed',
      error: 'Connection attempt failed.',
    });
    expect(wakeLock.release).toHaveBeenCalledTimes(1);
  });

  it('closing the chooser is a quiet cancel; other chooser errors are failures', async () => {
    const { store, bluetooth } = setup();
    bluetooth.chooser = 'cancel';
    await expect(store.connect('trainer')).resolves.toBe('cancelled');
    expect(store.getState().trainer.status).toBe('none');
    bluetooth.requestDevice = () => Promise.reject(new Error('Bluetooth adapter not available.'));
    await expect(store.connect('hr')).resolves.toBe('failed');
    expect(store.getState().hr).toMatchObject({ status: 'disconnected', reason: 'failed' });
  });

  it('a user disconnect does not reconnect; commands then fail fast', async () => {
    const { store, bluetooth, wakeLock } = setup();
    await store.connect('trainer');
    store.disconnect('trainer');
    expect(store.getState().trainer).toMatchObject({ status: 'disconnected', reason: 'user' });
    expect(bluetooth.devices.trainer.gatt.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.getState().trainer.status).toBe('disconnected');
    expect(wakeLock.release).toHaveBeenCalledTimes(1);
    await expect(store.trainer()!.command(requestControl())).rejects.toBeInstanceOf(
      NotConnectedError,
    );
    store.disconnect('hr'); // nothing connected: no-op
    await store.reconnect('hr');
  });

  it('choosing a new trainer replaces the old one', async () => {
    const { store } = setup();
    await store.connect('trainer');
    const first = store.trainer();
    await store.connect('trainer');
    expect(store.trainer()).not.toBe(first);
    expect(store.getState().trainer.status).toBe('connected');
  });

  it('connects a heart rate strap and streams readings', async () => {
    const { store, bluetooth } = setup({
      hr: new FakeHrSensor({ bpm: () => 142, rrPerPacket: 1 }),
    });
    await expect(store.connect('hr')).resolves.toBe('connected');
    const seen: number[] = [];
    store.hr()!.onReading((r) => seen.push(r.measurement.bpm));
    await ride(bluetooth, 2);
    expect(seen).toEqual([142, 142]);
    expect(store.hr()!.latest()!.measurement.contact).toBe('ok');
    bluetooth.dropLink('hr');
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().hr.status).toBe('connected');
  });

  it('an unsupported browser never opens a chooser', async () => {
    const store = createDeviceStore({
      support: { supported: false, reason: 'ios' },
      wakeLock: { acquire: async () => {}, release: async () => {} },
    });
    expect(store.getState()).toMatchObject({ supported: false, unsupportedReason: 'ios' });
    await expect(store.connect('trainer')).resolves.toBe('unsupported');
  });

  it('asks the chooser for FTMS trainers and HR straps with the services used later', () => {
    expect(REQUEST_OPTIONS.trainer.filters).toEqual([{ services: [0x1826] }]);
    expect(REQUEST_OPTIONS.trainer.optionalServices).toEqual([0x1818, 0x1816, 0x180a, 0x180f]);
    expect(REQUEST_OPTIONS.hr.filters).toEqual([{ services: [0x180d] }]);
  });
});

describe('setup failures', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it.each([
    ['trainer', CHARACTERISTIC.indoorBikeData],
    ['hr', CHARACTERISTIC.heartRateMeasurement],
  ] as const)(
    '%s: a failing notification start fails the connection cleanly',
    async (kind, uuid) => {
      const { store, bluetooth } = setup();
      bluetooth.failNotifications.add(uuid);
      await expect(store.connect(kind)).resolves.toBe('failed');
      expect(store.getState()[kind]).toMatchObject({ status: 'disconnected', reason: 'failed' });
      expect(bluetooth.devices[kind].gatt.connected).toBe(false);
      bluetooth.failNotifications.clear();
      await expect(store.connect(kind)).resolves.toBe('connected');
    },
  );

  it('works with engines that only have writeValue', async () => {
    const { store, bluetooth } = setup();
    await store.connect('trainer');
    const gatt = bluetooth.devices.trainer.gatt;
    const cp = gatt.chars.get(CHARACTERISTIC.fitnessMachineControlPoint)!;
    Object.defineProperty(cp, 'writeValueWithResponse', { value: undefined });
    const answer = store.trainer()!.command(requestControl());
    await vi.advanceTimersByTimeAsync(0);
    expect((await answer).result).toBe('success');
  });
});

describe('sharedDeviceStore', () => {
  it('is one store, unsupported in jsdom', async () => {
    const { sharedDeviceStore } = await import('./device-store');
    expect(sharedDeviceStore()).toBe(sharedDeviceStore());
    expect(sharedDeviceStore().getState().supported).toBe(false);
  });
});
