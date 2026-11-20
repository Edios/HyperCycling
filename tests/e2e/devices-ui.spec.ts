import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Pairing UI on the fake navigator.bluetooth from the e2e build hook. Pages build only (the UI
// is the same in both builds). Set SHOTS_DIR to also save screenshots for the PR.

declare global {
  interface Window {
    __fakeBt?: { pump(nowMs: number): void };
  }
}

async function openWithFake(page: Page, hash: string): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => window.__hcBle !== undefined);
  await page.evaluate((h) => {
    const fake = window.__hcBle!.installFake();
    window.__fakeBt = fake;
    // About 1 Hz of trainer and strap data, like real devices.
    setInterval(() => fake.pump(Date.now()), 500);
    location.hash = h;
  }, hash);
}

test.beforeEach(({ browserName }, info) => {
  void browserName; // Playwright needs a destructured fixture argument
  test.skip(info.project.name !== 'pages', 'pairing UI runs once, on the Pages build');
});

test('settings: connect trainer and strap, see live values, disconnect', async ({ page }) => {
  await openWithFake(page, '#/settings');
  const devices = page.getByTestId('equipment-devices');
  await expect(devices.getByRole('heading', { name: 'Bluetooth devices' })).toBeVisible();

  const trainer = devices.getByTestId('device-trainer');
  await trainer.getByRole('button', { name: 'Connect trainer' }).click();
  await expect(trainer).toHaveAttribute('data-status', 'connected');
  await expect(trainer.getByText('Fake Trainer 0001')).toBeVisible();
  await expect(trainer.getByText(/\d+ W · 90 rpm/)).toBeVisible();

  const hr = devices.getByTestId('device-hr');
  await hr.getByRole('button', { name: 'Connect strap' }).click();
  await expect(hr.getByText('120 bpm')).toBeVisible();

  // The setup screen shares the same connections.
  await page.evaluate(() => (location.hash = '#/setup/demo-mixed'));
  const setupTrainer = page.getByTestId('setup-screen').getByTestId('device-trainer');
  await expect(setupTrainer).toHaveAttribute('data-status', 'connected');
  await expect(setupTrainer.getByText(/\d+ W · 90 rpm/)).toBeVisible();
  await setupTrainer.getByRole('button', { name: 'Disconnect' }).click();
  await expect(setupTrainer.getByRole('button', { name: 'Connect trainer' })).toBeVisible();
});

test('unsupported browser: one clear sentence, no buttons', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__hcBle !== undefined);
  await page.evaluate(() => {
    window.__hcBle!.removeBluetooth();
    location.hash = '#/settings';
  });
  const devices = page.getByTestId('equipment-devices');
  await expect(devices.getByTestId('devices-unsupported')).toBeVisible();
  await expect(devices.getByRole('button')).toHaveCount(0);
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
    await openWithFake(page, '#/setup/demo-mixed');
    const idle = page.getByTestId('setup-screen').getByTestId('devices');
    await expect(idle.getByRole('button', { name: 'Connect trainer' })).toBeVisible();
    await idle.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/setup-idle-${vp.name}.png` });

    await page.evaluate(() => (location.hash = '#/settings'));
    const devices = page.getByTestId('equipment-devices');
    await devices.getByRole('button', { name: 'Connect trainer' }).click();
    await devices.getByRole('button', { name: 'Connect strap' }).click();
    await expect(devices.getByText('120 bpm')).toBeVisible();
    await devices.locator('details').evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await devices.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/settings-${vp.name}.png` });

    await page.evaluate(() => (location.hash = '#/setup/demo-mixed'));
    const setupDevices = page.getByTestId('setup-screen').getByTestId('devices');
    await expect(setupDevices.getByText('120 bpm')).toBeVisible();
    await setupDevices.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/setup-${vp.name}.png` });
  });
}
