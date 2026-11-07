import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Demo mix opens with a 2-minute ramp (effort 2 to 4) that a knob rider rides in three steps. */
async function startDemo(page: Page): Promise<void> {
  await page.clock.install();
  await page.goto('./?dev#/dev');
  const row = page.getByTestId('workout-row').filter({ hasText: 'Demo mix' });
  await row.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await expect(async () => {
    await page.keyboard.press('Space');
    await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'countdown', {
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });
  await page.clock.runFor(3200);
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running');
}

test('knob mode: stepped ramp shows the position badge, the step line and the pre-cue', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await startDemo(page);

  await expect(page.getByTestId('position-badge')).toHaveCount(1);
  await expect(page.getByTestId('position-badge')).toHaveAttribute('data-position', 'seated');
  await expect(page.getByTestId('step-line')).toHaveText('Step 1/3');
  await expect(page.getByTestId('effort-value-number')).toHaveText('02');

  // 5 s before the first step boundary (40 s) the coach says what to do, by target.
  await page.clock.runFor(35_000);
  await expect(page.getByTestId('coach-live')).toContainText('add resistance');
  await expect(page.getByTestId('coach-live')).toContainText('effort 3');

  await page.clock.runFor(6_000);
  await expect(page.getByTestId('step-line')).toHaveText('Step 2/3');
  await expect(page.getByTestId('effort-value-number')).toHaveText('03');
  expect(errors).toEqual([]);
});

test('a steady block shows no step line', async ({ page }) => {
  await startDemo(page);
  await page.keyboard.press('ArrowRight'); // skip the ramp: next block is steady
  await expect(page.getByTestId('timeline')).toContainText('block 2 of');
  await expect(page.getByTestId('step-line')).toHaveCount(0);
  await expect(page.getByTestId('position-badge')).toHaveCount(1);
});
