import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function addMe(page: Page, name: string, ftp: string): Promise<void> {
  await page.goto('./#/players');
  const form = page.getByTestId('add-player-form');
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('FTP (W)').fill(ftp);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('player-row').filter({ hasText: name })).toBeVisible();
  await page.getByRole('button', { name: `This is me: ${name}` }).click();
  await expect(
    page.getByRole('button', { name: `This is me: ${name}`, pressed: true }),
  ).toBeVisible();
}

test('settings: language switch applies at once, on other screens and after reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByRole('radio', { name: 'Polski' }).check({ force: true });
  await expect(page.getByRole('heading', { level: 1, name: 'Ustawienia' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  // Another screen is in Polish too.
  await page.getByRole('link', { name: /Gracze/ }).click();
  await expect(page.getByRole('heading', { name: 'Gracze' })).toBeVisible();

  // And it is remembered.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Gracze' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  // Back to English, so later tests start from the default.
  await page.goto('./#/settings');
  await page.getByRole('radio', { name: 'English' }).check({ force: true });
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('settings: the FTP calculator saves the result as my FTP', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const name = `Rider-${Date.now()}`;
  await addMe(page, name, '200');

  await page.goto('./#/settings');
  await expect(page.getByTestId('my-ftp').getByLabel('FTP (W)')).toHaveValue('200');

  await page.getByRole('button', { name: /FTP test guide/ }).click();
  await page.getByRole('radio', { name: '20-minute test' }).check({ force: true });
  await page.getByLabel('20-minute average power (W)').fill('300');
  await expect(page.getByTestId('ftp-result')).toHaveText('Your FTP: 285 W');
  await page.getByRole('button', { name: 'Save as my FTP' }).click();
  await expect(page.getByTestId('my-ftp').getByLabel('FTP (W)')).toHaveValue('285');

  await page.goto('./#/players');
  await expect(page.getByTestId('player-row').filter({ hasText: name })).toContainText('285');
  expect(errors).toEqual([]);
});

test('settings: zones reject a non-increasing table and keep valid edits after a reload', async ({
  page,
}) => {
  await page.goto('./#/settings');
  const level5 = page.getByLabel('% FTP for level 5');
  await level5.fill('60');
  await expect(page.getByText('Must be higher than the level below.')).toBeVisible();

  await page.getByLabel('% FTP for level 1').fill('40');
  await level5.fill('78');
  await expect(page.getByText('Must be higher than the level below.')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('% FTP for level 1')).toHaveValue('40');

  await page.getByRole('button', { name: 'Restore defaults' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByLabel('% FTP for level 1')).toHaveValue('45');
});

test('settings: the default background is preselected on the setup screen', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByTestId('settings-training').getByRole('radio', { name: 'Hyperride' }).check({
    force: true,
  });
  await expect(
    page.getByTestId('settings-training').getByRole('radio', { name: 'Hyperride' }),
  ).toBeChecked();
  await page.reload();
  await page.goto('./#/setup/ramp-test');
  await expect(page.getByRole('radio', { name: 'Hyperride', checked: true })).toBeVisible();

  // Put Basic back for the other tests.
  await page.goto('./#/settings');
  await page.getByTestId('settings-training').getByRole('radio', { name: 'Basic' }).check({
    force: true,
  });
  await expect(
    page.getByTestId('settings-training').getByRole('radio', { name: 'Basic' }),
  ).toBeChecked();
});
