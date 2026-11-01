import { expect, test } from '@playwright/test';

test('app loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('./');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  expect(errors).toEqual([]);
});
