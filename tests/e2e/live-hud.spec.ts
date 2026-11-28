import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Live trainer and strap values in the training HUD, on the fake navigator.bluetooth from the e2e
// build hook. Pages build only. Set SHOTS_DIR to also save screenshots for the PR.

declare global {
  interface Window {
    __pump?: ReturnType<typeof setInterval>;
    __fakeHub?: {
      writes: { bytes: Uint8Array }[];
      pump(nowMs: number): void;
      dropLink(kind: 'trainer' | 'hr', options?: { stayAway?: boolean }): void;
    };
  }
}

test.beforeEach(({ browserName }, info) => {
  void browserName; // Playwright needs a destructured fixture argument
  test.skip(info.project.name !== 'pages', 'live HUD runs once, on the Pages build');
});

async function rideWithSensors(page: Page): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => window.__hcBle !== undefined);
  await page.evaluate(() => {
    const hook = window.__hcBle!;
    const fake = hook.installFake({
      trainer: new hook.FakeTrainer({ noiseW: 0, freeRidePowerW: 180, powerTimeConstantMs: 300 }),
      hr: new hook.FakeHrSensor({ bpm: () => 148 }),
    });
    window.__fakeHub = fake;
    window.__pump = setInterval(() => fake.pump(Date.now()), 500);
    location.hash = '#/setup/demo-mixed';
  });
  const setup = page.getByTestId('setup-screen');
  await setup.getByRole('button', { name: 'Connect trainer' }).click();
  await setup.getByRole('button', { name: 'Connect strap' }).click();
  await expect(setup.getByText('148 bpm')).toBeVisible();
  await setup.getByRole('button', { name: 'Add', exact: true }).click();
  const form = page.getByTestId('add-player-form');
  await form.getByLabel('Name').fill('Mirek');
  await form.getByLabel('FTP (W)', { exact: true }).fill('250');
  await form.getByRole('button', { name: 'Add rider' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
}

async function startRide(page: Page): Promise<void> {
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'idle');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
    timeout: 10_000,
  });
}

const targetOf = async (page: Page): Promise<number> => {
  const name = (await page.getByTestId('effort-name').first().textContent()) ?? '';
  return Number(/target (\d+) W/.exec(name)?.[1]);
};

test('trainer mode: watts in the ring, ERG holds the target, ±5 %, ERG off, no signal', async ({
  page,
}) => {
  await rideWithSensors(page);
  const ring = page.getByTestId('effort-group').first();
  await expect(ring).toHaveAttribute('data-trainer', 'true');
  // One rider on the Classic tiles: no riders column, the ring carries the target.
  await expect(page.getByTestId('players-list')).toHaveCount(0);
  await expect(page.getByTestId('layout-solo')).toBeVisible();
  await expect(
    page.getByTestId('effort-ring-word').or(page.getByTestId('effort-caption')),
  ).toHaveText('Power');
  await expect(page.getByTestId('rpm-value-number')).toHaveText('90');
  await expect(page.getByTestId('live-hr')).toHaveText('148');
  await expect(page.getByTestId('live-power')).toHaveCount(0); // power lives in the ring now

  await startRide(page);
  const controls = page.getByTestId('erg-controls');
  await expect(controls).toHaveAttribute('data-status', 'erg', { timeout: 10_000 });
  const target = await targetOf(page);
  expect(target).toBeGreaterThan(0);
  // The fake trainer follows the target: the ring shows it within a few seconds.
  await expect(page.getByTestId('trainer-power')).toHaveText(String(target), { timeout: 10_000 });
  const writes = await page.evaluate(() =>
    window.__fakeHub!.writes.map((w) => Array.from(w.bytes)),
  );
  expect(writes.slice(0, 2)).toEqual([[0x00], [0x07]]);
  expect(writes.some((w) => w[0] === 0x05 && w[1]! + w[2]! * 256 === target)).toBe(true);

  // +5 %: a new target, and the trainer follows.
  await page.getByTestId('erg-harder').click();
  await expect(page.getByTestId('erg-bias')).toHaveText('+5%');
  const harder = await targetOf(page);
  expect(Math.abs(harder - target * 1.05)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('trainer-power')).toHaveText(String(harder), { timeout: 10_000 });
  // The same from the keyboard or a remote: ↑ / + is harder, ↓ / - easier.
  await page.locator('body').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('erg-bias')).toHaveText('+10%');
  await page.keyboard.press('Minus');
  await expect(page.getByTestId('erg-bias')).toHaveText('+5%');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('erg-bias')).toHaveCount(0); // back to the plan: no mark
  await page.keyboard.press('Equal');
  await expect(page.getByTestId('erg-bias')).toHaveText('+5%');

  // ERG off by hand: free ride on a flat road.
  await page.getByTestId('erg-toggle').click();
  await expect(controls).toHaveAttribute('data-status', 'manual');
  await expect(page.getByTestId('erg-toggle')).toHaveText('ERG off');
  await page.getByTestId('erg-toggle').click();
  await expect(controls).toHaveAttribute('data-status', 'erg');

  // The sensors go quiet: "—" in the ring and the rows (never 0), "No signal" in Measures.
  await page.evaluate(() => clearInterval(window.__pump));
  await expect(page.getByTestId('live-signal')).toHaveText('No signal', { timeout: 6000 });
  await expect(page.getByTestId('trainer-power')).toHaveText('—');
  await expect(page.getByTestId('live-hr')).toHaveText('—');

  // About 10 s of silence: auto-pause with a message; the ride goes on when data comes back.
  const screen = page.getByTestId('training-screen');
  await expect(screen).toHaveAttribute('data-status', 'paused', { timeout: 15_000 });
  await expect(
    page.getByText('No signal from the trainer: paused.', { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => {
    const fake = window.__fakeHub!;
    window.__pump = setInterval(() => fake.pump(Date.now()), 500);
  });
  await expect(screen).not.toHaveAttribute('data-status', 'paused', { timeout: 10_000 });
});

test('execution score: block result after a block, live score, total on the summary', async ({
  page,
}) => {
  await rideWithSensors(page);
  await startRide(page);
  await expect(page.getByTestId('erg-controls')).toHaveAttribute('data-status', 'erg', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('power-bar')).toBeVisible();
  await expect(page.getByTestId('block-score')).toHaveText(/^\d+% on target$/, { timeout: 10_000 });
  // The fake trainer has no noise: once ERG holds, the power sits exactly on the target and stays
  // unchanged. Every second must still count (review #115 B1), so the block is met.
  await expect(page.getByTestId('trainer-power')).toHaveText(String(await targetOf(page)), {
    timeout: 10_000,
  });
  await page.waitForTimeout(12_000);
  const live = Number(
    /^(\d+)%/.exec((await page.getByTestId('block-score').textContent()) ?? '')?.[1],
  );
  expect(live).toBeGreaterThanOrEqual(70);
  await page.keyboard.press('ArrowRight');
  const message = page.getByText(/^Block 1 met: \d+% on target$/);
  await expect(message).toBeVisible({ timeout: 5000 });
  const score = Number(/(\d+)%/.exec((await message.textContent()) ?? '')?.[1]);
  expect(score).toBeGreaterThanOrEqual(70);
  // End the ride: the summary shows the total.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'End and see summary' }).click();
  await expect(page.getByTestId('summary-execution')).toHaveText(
    /^Execution: \d+% on target · [1-9]\d* of \d+ blocks met$/,
  );
});

test('ride recording: the summary shows the ride and downloads it as JSON (T6)', async ({
  page,
}) => {
  await rideWithSensors(page);
  await startRide(page);
  await expect(page.getByTestId('erg-controls')).toHaveAttribute('data-status', 'erg', {
    timeout: 10_000,
  });
  // A short pause and resume, then a few more seconds of riding.
  await page.waitForTimeout(4000);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'paused');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running');
  await page.waitForTimeout(4000);
  // The controls hide while riding: Esc opens the same exit question.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'End and see summary' }).click();

  const card = page.getByTestId('summary-ride');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('ride-avg-power')).toHaveText(/^\d+ W$/);
  await expect(page.getByTestId('ride-hr')).toHaveText('148 / 148 bpm');
  await expect(page.getByTestId('ride-chart')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('button', { name: 'Download ride (JSON)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^hypercycling-ride-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const ride = JSON.parse(readFileSync(path, 'utf8')) as {
    schemaVersion: number;
    samples: { timeMs: number[]; power: (number | null)[]; heartRate: (number | null)[] };
    events: { kind: string }[];
  };
  expect(ride.schemaVersion).toBe(1);
  expect(ride.samples.power.length).toBeGreaterThanOrEqual(6);
  expect(ride.samples.heartRate).toContain(148);
  // 1 Hz wall-clock times for the FIT exporter (E2), rising with every sample.
  expect(ride.samples.timeMs).toHaveLength(ride.samples.power.length);
  expect(ride.samples.timeMs.every((t, i, all) => i === 0 || t > all[i - 1]!)).toBe(true);
  expect(ride.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['pause', 'resume']));
  // The same ride as a FIT file (Strava, Garmin Connect, intervals.icu).
  const [fitDownload] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('button', { name: 'Download FIT' }).click(),
  ]);
  expect(fitDownload.suggestedFilename()).toMatch(
    /^hypercycling-ride-\d{4}-\d{2}-\d{2}-\d{4}\.fit$/,
  );
  const fit = readFileSync(await fitDownload.path());
  expect(fit.subarray(8, 12).toString('ascii')).toBe('.FIT');
  expect(fit.readUInt32LE(4) + 16).toBe(fit.length); // header 14 + data + CRC 2
  // Kept on the device: the IndexedDB store holds it under the session log id.
  const stored = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('spinning-tutor');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('rides', 'readonly');
          const count = tx.objectStore('rides').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
      }),
  );
  expect(stored).toBe(1);
});

const VIEWPORTS = [
  { name: 'pc', width: 1280, height: 800 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
];

for (const vp of VIEWPORTS) {
  test(`screenshots ${vp.name}`, async ({ page }) => {
    const dir = process.env.SHOTS_DIR;
    test.skip(!dir, 'set SHOTS_DIR to save PR screenshots');
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await rideWithSensors(page);
    await startRide(page);
    await expect(page.getByTestId('erg-controls')).toHaveAttribute('data-status', 'erg', {
      timeout: 10_000,
    });
    const target = await targetOf(page);
    await expect(page.getByTestId('trainer-power')).toHaveText(String(target), {
      timeout: 10_000,
    });
    await page.mouse.move(vp.width / 2, vp.height / 2);
    // Range bars stay thin bars in every layout (a flex quirk once made one a tall blob).
    for (const id of ['power-bar', 'cadence-bar']) {
      const box = await page.getByTestId(id).first().boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.height, id).toBeLessThanOrEqual(16);
      expect(box!.width, id).toBeGreaterThan(40);
    }
    await page.screenshot({ path: `${dir}/erg-${vp.name}.png` });
    await page.evaluate(() => clearInterval(window.__pump));
    await expect(page.getByTestId('live-signal')).toHaveText('No signal', { timeout: 6000 });
    await page.screenshot({ path: `${dir}/erg-nosignal-${vp.name}.png` });
  });
}

// The real default profile (a knob bike without watts, no metered switch) with a trainer connected:
// the setup treats the trainer as the bike, so the ride must too (ERG chip and power in the ring).
test.describe('fresh profile', () => {
  test.use({ meteredBike: false });

  test('a connected trainer rides in trainer mode without the watts switch', async ({ page }) => {
    await rideWithSensors(page);
    await startRide(page);
    await expect(page.getByTestId('erg-controls')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('trainer-power')).toBeVisible();
    await expect(page.getByTestId('effort-group').first()).toHaveAttribute('data-trainer', 'true');
  });
});
