import { expect, test } from './fixtures';

// Lighter ride setup (UI audit N-05, N-06, N-07) and the plain mode captions on the start page.
// Pages build only (the UI is the same in both builds).

declare global {
  interface Window {
    __fakeBt?: { pump(nowMs: number): void };
  }
}

// These tests are about the real default bike: a knob without watts.
test.use({ meteredBike: false });

test.beforeEach(({ browserName }, info) => {
  void browserName; // Playwright needs a destructured fixture argument
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
});

test.describe('phone setup bar (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Freestyle: the chips replace the closed settings line; Ride settings opens it', async ({
    page,
  }) => {
    // The fixtures open Advanced by default; here it starts closed.
    await page.addInitScript(() => localStorage.setItem('hypercycling.setup.advanced', '0'));
    await page.goto('./#/setup/demo-mixed');
    await expect(page.getByTestId('start-bar')).toBeVisible();
    await expect(page.getByTestId('bar-more')).toBeVisible();
    await expect(page.getByTestId('advanced-toggle')).toBeHidden();
    await page.getByTestId('bar-more').click();
    await expect(page.getByTestId('advanced-toggle')).toBeVisible();
    await expect(page.getByTestId('advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
  });
});

test('a wide screen also has one way in: the chip, no closed settings line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => localStorage.setItem('hypercycling.setup.advanced', '0'));
  await page.goto('./#/setup/demo-mixed');
  await expect(page.getByTestId('bar-more')).toHaveText('Ride settings');
  await expect(page.getByTestId('advanced-toggle')).toBeHidden();
  await page.getByTestId('bar-more').click();
  await expect(page.getByTestId('advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('advanced-toggle')).toContainText('Ride settings');
});

test('Experience keeps its own settings line on a phone (no chips there)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('hypercycling.setup.advanced', '0'));
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await expect(page.getByTestId('advanced-toggle')).toBeVisible();
});

test('a new rider is not asked for FTP on the default bike; the field has a "?" otherwise', async ({
  page,
}) => {
  await page.goto('./#/setup/demo-mixed');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('add-player-form')).toBeVisible();
  await expect(page.getByLabel('FTP (W)', { exact: true })).toHaveCount(0);
});

test('a connected trainer is the bike: the bike line goes and FTP is asked with a "?"', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__hcBle !== undefined);
  await page.evaluate(() => {
    const fake = window.__hcBle!.installFake();
    window.__fakeBt = fake;
    setInterval(() => fake.pump(Date.now()), 500);
    location.hash = '#/setup/demo-mixed';
  });
  await expect(page.getByTestId('bike-line')).toBeVisible();
  const trainer = page.getByTestId('setup-screen').getByTestId('device-trainer');
  await trainer.getByRole('button', { name: 'Connect trainer' }).click();
  await expect(trainer).toHaveAttribute('data-status', 'connected');
  await expect(page.getByTestId('bike-line')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('FTP (W)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Help: FTP/ }).click();
  await expect(page.getByRole('note')).toContainText('hold for an hour');
});

test('start page captions are short and carry no counts', async ({ page }) => {
  await page.goto('./#/');
  const tiles = page.getByTestId('home').locator('a[data-tile]');
  await expect(tiles).toHaveCount(3);
  const text = (await tiles.allInnerTexts()).join(' ');
  expect(text).not.toMatch(/\d{2,}/);
  await expect(tiles.nth(1)).toContainText('Pick a workout and ride right away');
});
