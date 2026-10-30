import { expect, test, type Page } from '@playwright/test';

/** The page clock is installed before navigation so performance.now and rAF are controllable. */
async function openTraining(page: Page, buttonName: 'Ride' | 'Ride with players'): Promise<void> {
  await page.clock.install();
  await page.goto('./');
  await page.getByRole('button', { name: buttonName, exact: true }).first().click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
}

const status = (page: Page) => page.getByTestId('training-screen');

test('solo: countdown, running, block change, pause, skip, finish, summary', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await openTraining(page, 'Ride');
  await expect(page.getByTestId('layout-solo')).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-status', 'idle');

  await page.keyboard.press('Space');
  await expect(status(page)).toHaveAttribute('data-status', 'countdown');
  await expect(page.getByTestId('countdown')).toHaveText('3');
  await page.clock.runFor(1000);
  await expect(page.getByTestId('countdown')).toHaveText('2');
  await page.clock.runFor(2100);
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('block-timer')).toContainText('block 1 of');

  // Skip the 2-minute warm-up ramp, then let the 30 s push block end on its own.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('block-timer')).toContainText('block 2 of');
  await expect(page.getByTestId('effort-value')).toContainText('7');
  await page.clock.runFor(30_500);
  await expect(page.getByTestId('block-timer')).toContainText('block 3 of');
  await expect(page.getByTestId('effort-value')).toContainText('3');

  // Space pauses: time stays frozen while the clock runs.
  await page.keyboard.press('Space');
  await expect(status(page)).toHaveAttribute('data-status', 'paused');
  const frozen = (await page.getByTestId('block-timer').textContent()) ?? '';
  await page.clock.runFor(5000);
  await expect(page.getByTestId('block-timer')).toHaveText(frozen);
  await page.keyboard.press('Space');
  await expect(status(page)).toHaveAttribute('data-status', 'running');

  // ArrowRight skips to the next block.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('block-timer')).toContainText('block 4 of');

  // A long jump ends the workout and lands on the summary placeholder.
  await page.clock.fastForward(3_600_000);
  await expect(page.getByTestId('summary-screen')).toBeVisible();
  await expect(page.getByTestId('summary-name')).toHaveText('Demo mix');
  await expect(page.getByTestId('summary-status')).toHaveText('Completed');

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Workouts' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Escape asks before ending and goes to the summary', async ({ page }) => {
  await openTraining(page, 'Ride');
  await page.keyboard.press('Space');
  await page.clock.runFor(8000);
  await page.keyboard.press('Escape');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('End workout?');
  await dialog.getByRole('button', { name: 'Resume' }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page)).toHaveAttribute('data-status', 'running');

  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('button', { name: 'End' }).click();
  await expect(page.getByTestId('summary-status')).toHaveText('Ended early');
  await expect(page.getByTestId('summary-ridden')).toHaveText(/^0:0[56]$/);
});

test('players: shows target watts for both players', async ({ page }) => {
  await openTraining(page, 'Ride with players');
  const list = page.getByTestId('players-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Mirek');
  await expect(list).toContainText('Ania');
  // Ramp starts at effort 2 (55 % FTP): 270 -> 149 W, 190 -> 105 W.
  await expect(list).toContainText('149 W');
  await expect(list).toContainText('105 W');

  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('layout-solo')).toBeVisible();
});
