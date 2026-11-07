import { expect, test } from '@playwright/test';

test('heart-rate zones: HRmax from age, zone column and toggle in Settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./#/players');
  const form = page.getByTestId('add-player-form');
  const name = `Hr-${Date.now()}`;
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('FTP (W)').fill('220');
  await form.getByLabel('Age (not stored)').fill('36');
  await form.getByRole('button', { name: 'Calculate' }).click();
  await expect(form.getByLabel('Max heart rate (bpm)')).toHaveValue('183');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.getByTestId('player-row').filter({ hasText: name });
  await expect(row).toContainText('183');

  await page.goto('./#/settings');
  const zones = page.getByTestId('zones-table');
  await expect(zones.getByTestId('zone-hr').nth(5)).toHaveText('Z3 · 70–80 %');

  const toggle = page.getByRole('switch', { name: 'Show heart-rate zones' });
  await toggle.click();
  const state = await toggle.isChecked();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Show heart-rate zones' })).toBeChecked({
    checked: state,
  });
  expect(errors).toEqual([]);
});

test('plan wizard: the heart-rate step previews zones from the age', async ({ page }) => {
  await page.goto('./#/plans/wizard');
  await page.getByRole('radio', { name: /Build Form/ }).check({ force: true });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: /I don.t know it/ }).check({ force: true });
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await page.getByLabel('Age', { exact: true }).fill('36');
  await page.getByRole('button', { name: 'Suggest from age' }).click();
  await expect(page.getByLabel('Max heart rate')).toHaveValue('183');
  await expect(page.getByTestId('hr-preview')).toContainText('128–146 bpm');
});
