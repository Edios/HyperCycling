import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Live trainer and strap values in the training HUD, on the fake navigator.bluetooth from the e2e
// build hook. Pages build only. Set SHOTS_DIR to also save screenshots for the PR.

declare global {
  interface Window {
    __pump?: ReturnType<typeof setInterval>;
    __fakeHub?: {
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

test('training HUD: live power, cadence and heart rate; missing values on silence', async ({
  page,
}) => {
  await rideWithSensors(page);
  const measures = page.getByTestId('rpm-value');
  await expect(measures).toHaveAttribute('data-signal', 'live');
  await expect(page.getByTestId('live-power')).toHaveText('180');
  await expect(measures).toContainText(/target \d+ W/);
  await expect(page.getByTestId('rpm-value-number')).toHaveText('90');
  await expect(page.getByTestId('live-hr')).toHaveText('148');

  // The sensors go quiet: after 3 s the values become "—" (never 0) with a "No signal" line.
  await page.evaluate(() => clearInterval(window.__pump));
  await expect(page.getByTestId('live-signal')).toHaveText('No signal', { timeout: 6000 });
  await expect(page.getByTestId('live-power')).toHaveText('—');
  await expect(page.getByTestId('live-hr')).toHaveText('—');

  // A dropped trainer link says so until it is back.
  await page.evaluate(() => {
    const fake = window.__fakeHub!;
    window.__pump = setInterval(() => fake.pump(Date.now()), 500);
    fake.dropLink('trainer', { stayAway: true });
  });
  await expect(page.getByTestId('live-signal')).toHaveText('Reconnecting…');
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
    await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'idle');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
      timeout: 10_000,
    });
    await expect(page.getByTestId('live-power')).toHaveText('180');
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.screenshot({ path: `${dir}/hud-live-${vp.name}.png` });
    await page.evaluate(() => clearInterval(window.__pump));
    await expect(page.getByTestId('live-signal')).toHaveText('No signal', { timeout: 6000 });
    await page.screenshot({ path: `${dir}/hud-nosignal-${vp.name}.png` });
  });
}
