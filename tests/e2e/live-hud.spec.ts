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
  await form.getByLabel('FTP (W)').fill('250');
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
  // Ride a few seconds on target, then skip to the next block.
  await page.waitForTimeout(6000);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/^Block 1 (met|not met): \d+% on target$/)).toBeVisible({
    timeout: 5000,
  });
  // End the ride: the summary shows the total.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'End and see summary' }).click();
  await expect(page.getByTestId('summary-execution')).toHaveText(
    /^Execution: \d+% on target · \d+ of \d+ blocks met$/,
  );
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
    await page.screenshot({ path: `${dir}/erg-${vp.name}.png` });
    await page.evaluate(() => clearInterval(window.__pump));
    await expect(page.getByTestId('live-signal')).toHaveText('No signal', { timeout: 6000 });
    await page.screenshot({ path: `${dir}/erg-nosignal-${vp.name}.png` });
  });
}
