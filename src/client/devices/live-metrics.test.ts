import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHrSensor } from '../../domain/ble/fake-hr';
import { FakeTrainer } from '../../domain/ble/fake-trainer';
import { createDeviceStore } from './device-store';
import { FakeBluetooth } from './fake-bluetooth';
import { createLiveMetrics, liveMetricsFor, OFF_SNAPSHOT } from './live-metrics';

function setup(options: ConstructorParameters<typeof FakeBluetooth>[0] = {}) {
  const bluetooth = new FakeBluetooth(options);
  const store = createDeviceStore({
    support: { supported: true, bluetooth },
    wakeLock: { acquire: async () => {}, release: async () => {} },
    now: () => Date.now(),
  });
  const live = createLiveMetrics(store);
  return { bluetooth, store, live };
}

describe('createLiveMetrics', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('is off without devices', () => {
    const { live } = setup();
    expect(live.getSnapshot()).toBe(OFF_SNAPSHOT);
  });

  it('gives the power of the last second for the ride record; none without a trainer', async () => {
    const trainer = new FakeTrainer({ noiseW: 0, freeRidePowerW: 150 });
    const { bluetooth, store, live } = setup({ trainer });
    expect(live.secondPowerW()).toBeNull();
    await store.connect('trainer');
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      bluetooth.pump(Date.now());
    }
    expect(live.secondPowerW()).toBe(150);
    await vi.advanceTimersByTimeAsync(5000); // silent
    expect(live.secondPowerW()).toBeNull();
  });

  it('shows a 3 s power average, cadence and heart rate while data flows', async () => {
    const trainer = new FakeTrainer({ noiseW: 0, freeRidePowerW: 150 });
    const { bluetooth, store, live } = setup({
      trainer,
      hr: new FakeHrSensor({ bpm: () => 142 }),
    });
    await store.connect('trainer');
    await store.connect('hr');
    expect(live.getSnapshot()).toMatchObject({ trainer: 'stale', hr: 'stale', powerW: null });
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      bluetooth.pump(Date.now());
    }
    expect(live.getSnapshot()).toEqual({
      trainer: 'live',
      hr: 'live',
      powerW: 150,
      cadenceRpm: 90,
      hrBpm: 142,
      hrContact: 'ok',
    });
  });

  it('goes stale after 3 s of silence: values missing, never zero', async () => {
    const { bluetooth, store, live } = setup();
    await store.connect('trainer');
    bluetooth.pump(Date.now());
    expect(live.getSnapshot().trainer).toBe('live');
    await vi.advanceTimersByTimeAsync(3000);
    expect(live.getSnapshot().trainer).toBe('live');
    await vi.advanceTimersByTimeAsync(1000);
    expect(live.getSnapshot()).toMatchObject({ trainer: 'stale', powerW: null, cadenceRpm: null });
    bluetooth.pump(Date.now());
    expect(live.getSnapshot().trainer).toBe('live');
  });

  it('shows 0 W while the cranks stand still', async () => {
    let rpm = 90;
    const { bluetooth, store, live } = setup({
      trainer: new FakeTrainer({ noiseW: 0, cadenceRpm: () => rpm, powerTimeConstantMs: 1 }),
    });
    await store.connect('trainer');
    bluetooth.pump(Date.now());
    rpm = 0;
    await vi.advanceTimersByTimeAsync(500);
    bluetooth.pump(Date.now());
    expect(live.getSnapshot()).toMatchObject({ powerW: 0, cadenceRpm: 0 });
  });

  it('cadence goes missing when the trainer stops sending it, even while power still comes', async () => {
    const { bluetooth, store, live } = setup();
    await store.connect('trainer');
    bluetooth.pump(Date.now());
    expect(live.getSnapshot().cadenceRpm).toBe(90);
    // Power only (flags 0x0041: More Data + Instantaneous Power), 150 W, for 4 s.
    const gatt = bluetooth.devices.trainer.gatt;
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      gatt.emit(0x2ad2, Uint8Array.of(0x41, 0x00, 0x96, 0x00));
    }
    expect(live.getSnapshot()).toMatchObject({ trainer: 'live', cadenceRpm: null });
    expect(live.getSnapshot().powerW).not.toBeNull();
  });

  it('reports reconnecting and lost links', async () => {
    const { bluetooth, store, live } = setup();
    await store.connect('trainer');
    bluetooth.dropLink('trainer', { stayAway: true });
    expect(live.getSnapshot()).toMatchObject({ trainer: 'reconnecting', powerW: null });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(live.getSnapshot().trainer).toBe('lost');
    store.disconnect('trainer');
    expect(live.getSnapshot()).toBe(live.getSnapshot());
    expect(live.getSnapshot().trainer).toBe('off');
  });

  it('hides the heart rate while the strap has no skin contact', async () => {
    const hr = new FakeHrSensor({ bpm: () => 120 });
    const { bluetooth, store, live } = setup({ hr });
    await store.connect('hr');
    hr.contact = 'none';
    bluetooth.pump(Date.now());
    expect(live.getSnapshot()).toMatchObject({ hr: 'live', hrBpm: null, hrContact: 'none' });
  });

  it('publishes only when something changes and follows a newly chosen trainer', async () => {
    const { bluetooth, store, live } = setup({ trainer: new FakeTrainer({ noiseW: 0 }) });
    let calls = 0;
    live.subscribe(() => (calls += 1));
    await store.connect('trainer');
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      bluetooth.pump(Date.now());
    }
    const settled = calls;
    const snap = live.getSnapshot();
    await vi.advanceTimersByTimeAsync(1000);
    bluetooth.pump(Date.now());
    expect(live.getSnapshot()).toBe(snap);
    expect(calls).toBe(settled);
    await store.connect('trainer');
    expect(live.getSnapshot().powerW).toBeNull();
    bluetooth.pump(Date.now());
    expect(live.getSnapshot().trainer).toBe('live');
  });

  it('dispose stops updates; liveMetricsFor keeps one instance per store', async () => {
    const { bluetooth, store, live } = setup();
    live.dispose();
    await store.connect('trainer');
    bluetooth.pump(Date.now());
    expect(live.getSnapshot()).toBe(OFF_SNAPSHOT);
    expect(liveMetricsFor(store)).toBe(liveMetricsFor(store));
  });
});
