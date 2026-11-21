import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeTrainer } from '../../domain/ble/fake-trainer';
import type { Segment } from '../../domain/segments';
import { TRAINER_DEFAULTS, type TrainerSettings } from '../../domain/settings';
import { createDeviceStore } from './device-store';
import { createErgDriver, type ErgMoment } from './erg-driver';
import { FakeBluetooth } from './fake-bluetooth';

const FTP = 200;

function seg(index: number, durationSec: number, ftpPct: number, effort = 5): Segment {
  return {
    index,
    startSec: 0,
    durationSec,
    kind: 'steady',
    ftpPctStart: ftpPct,
    ftpPctEnd: ftpPct,
    effortStart: effort,
    effortEnd: effort,
    blockId: `b${index}`,
    rep: 1,
    reps: 1,
  } as Segment;
}

const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

async function setup(
  options: {
    fake?: ConstructorParameters<typeof FakeBluetooth>[0];
    settings?: Partial<TrainerSettings>;
    ftp?: number;
    onDeviceStop?: (reason: 'stopped' | 'safetyKey') => void;
  } = {},
) {
  const bluetooth = new FakeBluetooth(options.fake);
  const store = createDeviceStore({
    support: { supported: true, bluetooth },
    wakeLock: { acquire: async () => {}, release: async () => {} },
    now: () => Date.now(),
    backoffMs: [1000],
  });
  let moment: ErgMoment | null = {
    segment: seg(0, 300, 50),
    segmentIndex: 0,
    elapsedInSegSec: 10,
    running: true,
    finished: false,
    ftp: options.ftp ?? FTP,
  };
  const trainerSettings: TrainerSettings = { ...TRAINER_DEFAULTS, ...options.settings };
  await store.connect('trainer');
  const driver = createErgDriver({
    store,
    moment: () => moment,
    settings: () => trainerSettings,
    now: () => Date.now(),
    ...(options.onDeviceStop ? { onDeviceStop: options.onDeviceStop } : {}),
  });
  const writes = () => bluetooth.writes.map((w) => hex(w.bytes));
  /** Lets time pass, then runs decision steps until the commands in flight are answered. */
  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 4; i++) {
      const done = driver.step();
      await vi.advanceTimersByTimeAsync(5);
      await done;
    }
  };
  /** Long enough for the entry ramp (4 s) to reach the target. */
  const warm = async () => {
    for (let i = 0; i < 6; i++) await settle(1000);
  };
  return {
    bluetooth,
    store,
    driver,
    writes,
    settle,
    warm,
    setMoment: (m: Partial<ErgMoment> | null) => {
      moment = m === null ? null : { ...moment!, ...m };
    },
  };
}

describe('ERG driver', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('takes control and writes the target: Request Control → Start → Set Target Power', async () => {
    const { driver, writes, warm } = await setup();
    await warm();
    // Entry ramp: half the target first (no measured power yet), the full target after ~4 s.
    expect(writes().slice(0, 3)).toEqual(['00', '07', '05 32 00']);
    expect(writes().at(-1)).toBe('05 64 00');
    expect(driver.getSnapshot()).toMatchObject({ status: 'erg', targetW: 100, enabled: true });
    driver.dispose();
  });

  it('changes the target at a block boundary within one tick; small moves inside a block wait', async () => {
    const { driver, writes, settle, warm, setMoment } = await setup();
    await warm();
    setMoment({ segment: seg(1, 300, 75), segmentIndex: 1 });
    await settle(1000);
    expect(writes().at(-1)).toBe('05 96 00');
    // +1 % FTP inside the block: under max(3 W, 1 % FTP) → nothing written.
    setMoment({ segment: seg(1, 300, 76) });
    await settle(1000);
    expect(writes().at(-1)).toBe('05 96 00');
    driver.dispose();
  });

  it('spreads a jump above 30 % FTP over about 3 s', async () => {
    const { driver, writes, settle, warm, setMoment } = await setup();
    await warm();
    setMoment({ segment: seg(1, 300, 150), segmentIndex: 1 });
    const targets: number[] = [];
    for (let i = 0; i < 5; i++) {
      await settle(1000);
      const last = writes().at(-1)!.split(' ');
      targets.push(parseInt(last[2]! + last[1]!, 16));
    }
    expect(targets[0]).toBeLessThan(300);
    expect(targets.at(-1)).toBe(300);
    expect([...targets].sort((a, b) => a - b)).toEqual(targets);
    driver.dispose();
  });

  it('pauses with Stop/Pause and resumes with Start + the target', async () => {
    const { driver, writes, settle, warm, setMoment } = await setup();
    await warm();
    setMoment({ running: false });
    await settle(1000);
    expect(writes().at(-1)).toBe('08 02');
    expect(driver.getSnapshot().status).toBe('paused');
    setMoment({ running: true });
    const before = writes().length;
    await warm();
    // Resume: Start, then an entry ramp, never the full load at once (review #113 B3).
    expect(writes().slice(before, before + 2)).toEqual(['07', '05 32 00']);
    expect(writes().at(-1)).toBe('05 64 00');
    driver.dispose();
  });

  it('sprint blocks ride on fixed resistance (SINT16 ×0.1); sprint mode can be off', async () => {
    const a = await setup();
    await a.warm();
    a.setMoment({ segment: seg(1, 20, 150, 10), segmentIndex: 1 });
    await a.settle(1000);
    expect(a.writes().at(-1)).toBe('04 90 01');
    expect(a.driver.getSnapshot().status).toBe('resistance');
    a.setMoment({ segment: seg(2, 300, 50), segmentIndex: 2 });
    const back = a.writes().length;
    await a.warm();
    // Back to ERG after the sprint: an entry ramp, then the target.
    expect(a.writes()[back]).toBe('05 32 00');
    expect(a.writes().at(-1)).toBe('05 64 00');
    a.driver.dispose();

    const b = await setup({ settings: { sprintMode: false } });
    b.setMoment({ segment: seg(1, 20, 150, 10), segmentIndex: 1 });
    await b.warm();
    expect(b.writes().at(-1)).toBe('05 2C 01');
    b.driver.dispose();
  });

  it('ERG off by hand: flat road (full Crr/Cw, never zeros); back on resends the target', async () => {
    const { driver, writes, settle, warm } = await setup();
    await warm();
    driver.setEnabled(false);
    await settle(1000);
    expect(writes().at(-1)).toBe('11 00 00 00 00 28 33');
    expect(driver.getSnapshot()).toMatchObject({ status: 'manual', enabled: false });
    driver.setEnabled(true);
    await settle(1000);
    expect(writes().at(-1)).toBe('05 64 00');
    driver.dispose();
  });

  it('±5 % adjusts the target', async () => {
    const { driver, writes, settle, warm } = await setup();
    await warm();
    driver.nudge(1);
    await settle(1000);
    expect(writes().at(-1)).toBe('05 69 00');
    driver.nudge(-3);
    await settle(1000);
    expect(writes().at(-1)).toBe('05 5A 00');
    expect(driver.getSnapshot().biasPct).toBe(-10);
    driver.dispose();
  });

  it('after a dropped link the whole sequence runs again with the current target', async () => {
    const { bluetooth, driver, writes, settle, warm } = await setup();
    await warm();
    const before = writes().length;
    bluetooth.dropLink('trainer');
    await warm();
    await settle(1000);
    await warm();
    expect(writes().slice(before, before + 3)).toEqual(['00', '07', '05 32 00']);
    expect(writes().at(-1)).toBe('05 64 00');
    driver.dispose();
  });

  it('control lost (0xFF) → Request Control again', async () => {
    const { bluetooth, driver, writes, warm } = await setup();
    await warm();
    bluetooth.takeControlAway();
    const before = writes().length;
    await warm();
    expect(writes().slice(before, before + 2)).toEqual(['00', '07']);
    expect(writes().at(-1)).toBe('05 64 00');
    driver.dispose();
  });

  it('another app holds the trainer: blocked after two refusals; retry works once it is free', async () => {
    const { bluetooth, driver, warm } = await setup({
      fake: { trainer: new FakeTrainer({ faults: { rejectControl: true } }) },
    });
    await warm();
    expect(driver.getSnapshot().status).toBe('blocked');
    bluetooth.trainer.faults = {};
    driver.retry();
    await warm();
    expect(driver.getSnapshot().status).toBe('erg');
    driver.dispose();
  });

  it('a trainer that does not take power targets is "unsupported"', async () => {
    const { driver, warm } = await setup({
      fake: { trainer: new FakeTrainer({ faults: { unsupportedOpcodes: [0x05] } }) },
    });
    await warm();
    expect(driver.getSnapshot().status).toBe('unsupported');
    driver.dispose();
  });

  it('two silent Control Point attempts force one reconnect', async () => {
    const { bluetooth, store, driver, settle } = await setup();
    bluetooth.trainer.faults = { dropResponses: true };
    await settle(7000);
    await settle(7000);
    expect(store.log.toText()).toContain('ERG: forcing a reconnect (two Control Point timeouts)');
    driver.dispose();
  });

  it('watchdog: connected but silent while riding → reconnect', async () => {
    const { bluetooth, store, driver, settle } = await setup();
    bluetooth.pump(Date.now());
    await settle(1000);
    await settle(13_000);
    expect(store.log.toText()).toContain('ERG: forcing a reconnect (no data)');
    driver.dispose();
  });

  it('cadence guard (when on) halves the target after 3 s under 55 rpm', async () => {
    const { bluetooth, driver, writes, settle } = await setup({
      fake: { trainer: new FakeTrainer({ cadenceRpm: () => 40 }) },
      settings: { cadenceGuard: true },
    });
    for (let i = 0; i < 10; i++) {
      bluetooth.pump(Date.now());
      await settle(1000);
    }
    expect(writes().at(-1)).toBe('05 32 00');
    expect(driver.getSnapshot().guardActive).toBe(true);
    driver.dispose();
  });

  it('finish: Stop then Reset; no ride: idle', async () => {
    const { driver, writes, settle, warm, setMoment } = await setup();
    await warm();
    setMoment(null);
    await settle(1000);
    expect(driver.getSnapshot().status).toBe('paused');
    const finished = driver.finish();
    await vi.advanceTimersByTimeAsync(20);
    await finished;
    expect(writes().slice(-2)).toEqual(['08 01', '01']);
    expect(driver.getSnapshot().status).toBe('idle');
    driver.dispose();
  });

  it('never has two commands in flight', async () => {
    const { bluetooth, driver } = await setup({ fake: { responseDelayMs: 400 } });
    void driver.step();
    void driver.step();
    void driver.step();
    await vi.advanceTimersByTimeAsync(0);
    expect(bluetooth.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    driver.dispose();
  });

  it('without a trainer it stays idle', async () => {
    const { store, driver, settle } = await setup();
    store.disconnect('trainer');
    await settle(1000);
    expect(driver.getSnapshot().status).toBe('idle');
    driver.dispose();
  });

  describe('review #113', () => {
    it('B1: the end of the ride sends Stop and Reset; the trainer has no target left', async () => {
      const { bluetooth, driver, writes, settle, warm, setMoment } = await setup();
      await warm();
      expect(bluetooth.trainer.targetPowerW).toBe(100);
      setMoment({ running: false, finished: true });
      await settle(1000);
      expect(writes().slice(-2)).toEqual(['08 01', '01']);
      expect(bluetooth.trainer.targetPowerW).toBeNull();
      expect(bluetooth.trainer.hasControl).toBe(false);
      expect(driver.getSnapshot().status).toBe('idle');
      // It stays released: no new Request Control after the end.
      const n = writes().length;
      await settle(3000);
      expect(writes()).toHaveLength(n);
      driver.dispose();
    });

    it('B1: closing the page sends Stop and Reset at once', async () => {
      const { finishOnPagehide } = await import('../training/useErg');
      const { bluetooth, driver, writes, warm } = await setup();
      await warm();
      const off = finishOnPagehide(driver, window);
      window.dispatchEvent(new Event('pagehide'));
      await vi.advanceTimersByTimeAsync(20);
      expect(writes().slice(-2)).toEqual(['08 01', '01']);
      expect(bluetooth.trainer.targetPowerW).toBeNull();
      off();
      driver.dispose();
    });

    it('B2: a 10 s rest and both halves of 15/15 stay in ERG', async () => {
      const { driver, writes, warm, setMoment } = await setup();
      await warm();
      setMoment({ segment: seg(1, 10, 45, 1), segmentIndex: 1 });
      await warm();
      expect(driver.getSnapshot().status).toBe('erg');
      setMoment({ segment: seg(2, 15, 120, 9), segmentIndex: 2 });
      await warm();
      expect(writes().at(-1)).toBe('04 90 01'); // short AND hard: sprint
      setMoment({ segment: seg(3, 15, 50, 2), segmentIndex: 3 });
      await warm();
      expect(driver.getSnapshot().status).toBe('erg');
      driver.dispose();
    });

    it('B3: reconnect in a 120 % FTP interval ramps in instead of the full load', async () => {
      const { bluetooth, writes, settle, warm, setMoment, driver } = await setup();
      setMoment({ segment: seg(0, 300, 120, 8), segmentIndex: 0 });
      await warm();
      expect(writes().at(-1)).toBe('05 F0 00'); // 240 W
      const before = writes().length;
      bluetooth.dropLink('trainer');
      await settle(1000);
      await settle(1000);
      const firstTarget = writes()
        .slice(before)
        .find((w) => w.startsWith('05'))!
        .split(' ');
      const watts = parseInt(firstTarget[2]! + firstTarget[1]!, 16);
      expect(watts).toBeLessThanOrEqual(150);
      await warm();
      expect(writes().at(-1)).toBe('05 F0 00');
      driver.dispose();
    });
  });

  describe('review #113, non-critical', () => {
    it('a stop on the device (safety key 0x03) pauses the ride; ERG waits for a resume', async () => {
      const stops: string[] = [];
      const { bluetooth, driver, writes, warm, setMoment } = await setup({
        onDeviceStop: (r) => stops.push(r),
      });
      await warm();
      bluetooth.devices.trainer.gatt.emit(0x2ada, Uint8Array.of(0x03));
      expect(stops).toEqual(['safetyKey']);
      const n = writes().length;
      await warm(); // still "running": no new control
      expect(writes()).toHaveLength(n);
      expect(driver.getSnapshot().status).toBe('paused');
      setMoment({ running: false });
      await warm();
      setMoment({ running: true });
      await warm();
      expect(writes().slice(n, n + 2)).toEqual(['00', '07']);
      expect(driver.getSnapshot().status).toBe('erg');
      driver.dispose();
    });

    it('a stop/pause on the device (0x02) counts too, our own pause does not', async () => {
      const stops: string[] = [];
      const { bluetooth, driver, warm, setMoment } = await setup({
        onDeviceStop: (r) => stops.push(r),
      });
      await warm();
      setMoment({ running: false }); // our own Stop/Pause → status 0x02
      await warm();
      expect(stops).toEqual([]);
      setMoment({ running: true });
      await warm();
      bluetooth.devices.trainer.gatt.emit(0x2ada, Uint8Array.of(0x02, 0x01));
      expect(stops).toEqual(['stopped']);
      driver.dispose();
    });

    it('an FTP outside 50–600 W gives no ERG target', async () => {
      const { driver, writes, warm } = await setup({ ftp: 900 });
      await warm();
      expect(driver.getSnapshot().status).toBe('ftpInvalid');
      expect(writes().some((w) => w.startsWith('05'))).toBe(false);
      driver.dispose();
    });

    it('failing writes back off (1, 2, 4, 8 s …) instead of retrying every second', async () => {
      const { bluetooth, driver, warm } = await setup();
      const gatt = bluetooth.devices.trainer.gatt;
      let attempts = 0;
      const cp = gatt.chars.get(0x2ad9)!;
      cp.writeValue = async () => {
        attempts += 1;
        throw Object.assign(new Error('GATT operation failed'), { name: 'NetworkError' });
      };
      cp.writeValueWithResponse = cp.writeValue;
      for (let i = 0; i < 3; i++) await warm(); // ~18 s
      expect(attempts).toBeGreaterThan(1);
      expect(attempts).toBeLessThanOrEqual(6);
      driver.dispose();
    });
  });
});
