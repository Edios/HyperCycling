import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

test('plan tab with an active plan: Ride starts the training screen', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await seedSettings(page, info, 'build-form');
  await expect(page.getByTestId('next-session')).toBeVisible();
  await expect(page.getByTestId('weeks-list').getByRole('listitem')).toHaveCount(8);
  await expect(page.getByTestId('plan-done')).toContainText('0 of');

  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await expect(page.getByTestId('setup-badge')).toContainText('Progres · week 1');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'idle');
  expect(errors).toEqual([]);
});

test('without an active plan the Plan tab offers to choose one', async ({ page }, info) => {
  await seedSettings(page, info, null);
  await expect(page.getByTestId('plan-empty')).toBeVisible();
});

test('freestyle tab filters and searches', async ({ page }) => {
  await page.goto('./#/freestyle');
  const cards = page.getByTestId('workout-card');
  await expect(cards.first()).toBeVisible();
  const all = await cards.count();
  await page.getByRole('button', { name: 'HIIT', exact: true }).click();
  const hiit = await cards.count();
  expect(hiit).toBeGreaterThan(0);
  expect(hiit).toBeLessThan(all);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('searchbox').fill('tabata');
  await expect(cards.first()).toContainText(/tabata/i);
  await cards.first().click();
  await page.getByTestId('workout-ride').click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
});
