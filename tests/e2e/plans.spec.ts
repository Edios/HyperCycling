import { expect, test, type Page } from '@playwright/test';

async function nextSessionMinutes(page: Page): Promise<number> {
  // The hero card shows the scaled length as "<n> min" next to the title.
  const text = await page.getByTestId('next-session').innerText();
  const match = /(\d+)\s*min/.exec(text);
  if (!match) throw new Error(`No minutes in: ${text}`);
  return Number.parseInt(match[1] as string, 10);
}

test('gallery filters and opens a plan', async ({ page }) => {
  await page.goto('./#/plans');
  const cards = page.getByTestId('plan-card');
  await expect(cards).toHaveCount(4);
  await page.getByRole('button', { name: 'Short', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(cards).toHaveCount(4);
  await cards
    .filter({ hasText: 'Build Form' })
    .getByRole('button', { name: /Choose|Customize/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Build Form' })).toBeVisible();
});

test('Build Form at 30 min shortens a scalable session but never the FTP test', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./#/plans/build-form');
  await page.getByRole('radio', { name: '45 min' }).check({ force: true });
  // Week 1 progres is the 20-minute FTP test (never scaled); the freestyle preview follows the length.
  const preview45 = await page.getByTestId('preview-freestyle-minutes').innerText();
  // Other specs may have activated Build Form already (shared local database): then it is Save changes.
  await page.getByRole('button', { name: /^(Start plan|Save changes)$/ }).click();
  await expect(page.getByTestId('next-session')).toBeVisible();
  const at45 = await nextSessionMinutes(page);

  // Active now: the same screen offers Save changes.
  await page.goto('./#/plans/build-form');
  await page.getByRole('radio', { name: '30 min' }).check({ force: true });
  const preview30 = await page.getByTestId('preview-freestyle-minutes').innerText();
  expect(Number.parseInt(preview30, 10)).toBeLessThan(Number.parseInt(preview45, 10));
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('next-session')).toBeVisible();
  const at30 = await nextSessionMinutes(page);

  expect(at30).toBe(at45);
  expect(errors).toEqual([]);
});
