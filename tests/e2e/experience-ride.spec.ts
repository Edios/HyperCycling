import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

// The keydown binding can land just after the screen shows; press again until the countdown starts.
async function startCountdown(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Space');
    await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'countdown', {
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });
}

test('Neon Grid 45: Home tile → picker → Setup → ride (shortened) → summary with chapters', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.clock.install();
  await seedSettings(page, info, null);

  // Home: the Experience tile features Neon Grid; the secondary action opens the catalogue
  await page.goto('./#/');
  await page.locator('[data-tile="experience"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Neon Grid');
  await page.getByTestId('home-secondary').click();
  // The catalogue holds the 30-minute, the 45-minute and the light variant; ride the full 45.
  await expect(page.getByTestId('experience-card')).toHaveCount(3);
  const card = page.locator('[data-testid="experience-card"][data-experience="neon-grid-45"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('11 songs');
  await card.getByRole('button', { name: 'Show scenario' }).click();
  await expect(page.getByTestId('experience-scenario').locator('li')).toHaveCount(11);

  // Setup is preset for the Experience: the Scenes world
  await card.getByTestId('experience-start').click();
  await expect(page.getByTestId('setup-experience')).toContainText('Neon Grid 45');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();

  // Ride: skip a block, then jump through the whole 45 minutes (World frames are not replayed)
  await startCountdown(page);
  await page.clock.runFor(3100);
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('timeline')).toContainText('block 1 of');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('timeline')).toContainText('block 2 of');
  await page.clock.fastForward(50 * 60_000);

  const summary = page.getByTestId('summary-screen');
  await expect(summary).toBeVisible();
  await expect(page.getByTestId('summary-name')).toHaveText('Neon Grid 45');
  await expect(page.getByTestId('summary-status')).toHaveText('Completed');
  const chapters = page.getByTestId('summary-experience');
  await expect(chapters).toContainText('7 of 7');
  await expect(chapters.locator('li')).toHaveCount(7);

  // Ride again returns to the same Experience's setup
  await page.getByRole('button', { name: 'Ride again' }).click();
  await expect(page.getByTestId('setup-experience')).toContainText('Neon Grid 45');
  expect(errors).toEqual([]);
});
