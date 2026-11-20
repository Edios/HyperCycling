import { expect, test } from './fixtures';

// The Bluetooth transport in a real browser: a fake navigator.bluetooth (exposed by the e2e build
// hook) drives the actual connection, GATT queue, Control Point and reconnect code. There is no
// pairing UI yet (T3), so the tests talk to the transport through window.__hcBle. Pages build
// only: the transport is the same in both builds and one run is enough.
test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'pages', 'transport runs once, on the Pages build');
  await page.goto('./');
  await page.waitForFunction(() => window.__hcBle !== undefined);
});

test('ERG sequence through the fake trainer: 200 W reaches ±5 %', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const hook = window.__hcBle!;
    const fake = hook.installFake({
      trainer: new hook.FakeTrainer({ seed: 5, powerTimeConstantMs: 2000 }),
    });
    const support = hook.detectBluetoothSupport();
    const store = hook.createDeviceStore({
      wakeLock: { acquire: async () => {}, release: async () => {} },
    });
    const outcome = await store.connect('trainer');
    const trainer = store.trainer()!;
    // Simulated time: 10 s of free riding, then ERG and 6 s more.
    for (let t = 1000; t <= 10_000; t += 1000) fake.pump(t);
    const answers = [];
    for (const cmd of [
      hook.ftms.requestControl(),
      hook.ftms.startOrResume(),
      hook.ftms.setTargetPower(200),
    ]) {
      answers.push((await trainer.command(cmd)).result);
    }
    for (let t = 11_000; t <= 16_000; t += 1000) fake.pump(t);
    return {
      supported: support.supported,
      outcome,
      state: store.getState().trainer.status,
      answers,
      power: trainer.latest()?.data.powerW,
      writes: fake.writes.map((w) => Array.from(w.bytes)),
    };
  });
  expect(result).toMatchObject({
    supported: true,
    outcome: 'connected',
    state: 'connected',
    answers: ['success', 'success', 'success'],
    writes: [[0x00], [0x07], [0x05, 0xc8, 0x00]],
  });
  expect(result.power).toBeGreaterThanOrEqual(190);
  expect(result.power).toBeLessThanOrEqual(210);
});

test('link drop: reconnect with backoff and data again; unsupported browser', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const hook = window.__hcBle!;
    const fake = hook.installFake();
    const store = hook.createDeviceStore({
      backoffMs: [100, 200],
      wakeLock: { acquire: async () => {}, release: async () => {} },
    });
    await store.connect('trainer');
    await store.connect('hr');
    const states: string[] = [];
    store.subscribe(() => states.push(store.getState().trainer.status));
    fake.dropLink('trainer');
    await new Promise((r) => setTimeout(r, 400));
    fake.pump(1000);
    const after = {
      states,
      cadence: store.trainer()!.latest()?.data.cadenceRpm,
      bpm: store.hr()!.latest()?.measurement.bpm,
    };
    hook.removeBluetooth();
    const unsupported = hook.detectBluetoothSupport();
    return { after, unsupported };
  });
  expect(result.after).toEqual({ states: ['reconnecting', 'connected'], cadence: 90, bpm: 120 });
  expect(result.unsupported).toMatchObject({ supported: false });
});
