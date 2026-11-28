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
  await expect(page.getByTestId('setup-badge')).toContainText('Progress · week 1');
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
  // "All" shows the library in groups of a few rows; the counter has the whole number.
  const all = Number((await page.getByText(/^Workouts: \d+$/).textContent())?.replace(/\D/g, ''));
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

test('each kind says what it does; "Easy start" keeps no hard workouts', async ({ page }) => {
  await page.goto('./#/freestyle');
  const cards = page.getByTestId('workout-card');
  await expect(cards.first()).toBeVisible();
  // "Zone 2 · easy and long, builds the base": the kind and its effect on one line.
  await expect(cards.first().getByTestId('workout-kind')).toContainText(' · ');
  await page.getByRole('button', { name: 'Easy start', exact: true }).click();
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  for (const kind of await page.getByTestId('workout-kind').allTextContents()) {
    expect(kind).not.toMatch(/^(HIIT|Tests|Climbs|Sprints|Threshold|VO2)\b/);
  }
});

test('the effect of every kind is readable on a phone in landscape (844 x 390)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('./#/freestyle');
  await expect(page.getByTestId('workout-card').first()).toBeVisible();
  // Review of #180: 14 of 20 kinds were cut with an ellipsis. Two lines now; nothing clipped.
  const clipped = await page
    .getByTestId('workout-kind')
    .evaluateAll((els) =>
      els
        .filter(
          (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
        )
        .map((el) => el.textContent),
    );
  expect(clipped).toEqual([]);
  for (const el of await page.getByTestId('workout-kind').all()) {
    expect(await el.getAttribute('title')).toContain(' · ');
  }
});
