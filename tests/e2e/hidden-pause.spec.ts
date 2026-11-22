import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Bug #17: on a phone the ride pauses when the app leaves the screen and a "Resume" card waits for
 * a tap, so the music can play again. A computer keeps riding. The page clock is installed before
 * navigation so performance.now and rAF are controllable.
 */
async function rideRunning(page: Page, ride = 'Ride'): Promise<void> {
  await page.clock.install();
  await page.goto('./?dev#/dev');
  // The deterministic demo workout (its name is translated, so the first row in Polish).
  const rows = page.getByTestId('workout-row');
  const row = ride === 'Ride' ? rows.filter({ hasText: 'Demo mix' }) : rows.first();
  await row.getByRole('button', { name: ride, exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await page.getByTestId('controls').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'countdown');
  await page.clock.runFor(3100);
  await page.clock.runFor(2000);
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running');
}

/** What the browser does when the app is minimised, switched away from or the screen is locked. */
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('hiding the app pauses the ride; Resume goes on from the same moment', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await rideRunning(page);
    const status = page.getByTestId('training-screen');
    const timer = page.getByTestId('block-timer');

    await setVisibility(page, 'hidden');
    await expect(status).toHaveAttribute('data-status', 'paused');
    const frozen = (await timer.textContent()) ?? '';
    await page.clock.runFor(60_000); // a minute in another app
    await setVisibility(page, 'visible');

    const card = page.getByTestId('hidden-pause');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Ride paused');
    await expect(timer).toHaveText(frozen);

    await card.getByRole('button', { name: 'Resume' }).tap();
    await expect(status).toHaveAttribute('data-status', 'running');
    await expect(card).toBeHidden();
    await expect(timer).toHaveText(frozen);
    await page.clock.runFor(2000);
    await expect(timer).not.toHaveText(frozen);
    expect(errors).toEqual([]);
  });
});

test.describe('phone, Polish', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'pl-PL',
  });

  test('the Resume card speaks Polish', async ({ page }) => {
    await rideRunning(page, 'Jedź');
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    const card = page.getByTestId('hidden-pause');
    await expect(card).toContainText('Jazda wstrzymana');
    await expect(card.getByRole('button', { name: 'Wznów' })).toBeVisible();
  });
});

test('computer: hiding the tab keeps the ride going', async ({ page }) => {
  await rideRunning(page);
  await setVisibility(page, 'hidden');
  await page.clock.runFor(1000);
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running');
  await setVisibility(page, 'visible');
  await expect(page.getByTestId('hidden-pause')).toHaveCount(0);
});
