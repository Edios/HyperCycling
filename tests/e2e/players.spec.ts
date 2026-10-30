import { expect, test, type Page } from '@playwright/test';

async function add(page: Page, name: string, ftp: string): Promise<void> {
  const form = page.getByTestId('add-player-form');
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('FTP (W)').fill(ftp);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('player-row').filter({ hasText: name })).toBeVisible();
}

test('players: add two, mark me, edit, delete; everything survives a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./#/players');
  await expect(page.getByTestId('players-screen')).toBeVisible();
  // The shared e2e storage may hold players from other tests; use unique names.
  const a = `Ania-${Date.now()}`;
  const b = `Tomek-${Date.now()}`;
  await add(page, a, '190');
  await add(page, b, '310');

  await page.getByRole('button', { name: `This is me: ${a}` }).click();
  await expect(page.getByRole('button', { name: `This is me: ${a}`, pressed: true })).toBeVisible();
  await page.getByRole('button', { name: `This is me: ${b}` }).click();
  await expect(page.getByRole('button', { name: `This is me: ${b}`, pressed: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `This is me: ${a}`, pressed: false }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('player-row').filter({ hasText: a })).toContainText('190');
  await expect(page.getByTestId('player-row').filter({ hasText: b })).toContainText('310');
  await expect(page.getByRole('button', { name: `This is me: ${b}`, pressed: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `This is me: ${a}`, pressed: false }),
  ).toBeVisible();

  await page.getByRole('button', { name: `Edit ${a}` }).click();
  const edit = page.getByTestId('player-edit');
  await edit.getByLabel('FTP (W)').fill('20');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit.getByText('FTP must be a whole number from 50 to 600')).toBeVisible();
  await edit.getByLabel('FTP (W)').fill('230');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('player-row').filter({ hasText: a })).toContainText('230');

  await page.getByRole('button', { name: `Delete ${a}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('player-row').filter({ hasText: a })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('player-row').filter({ hasText: b })).toBeVisible();
  await expect(page.getByTestId('player-row').filter({ hasText: a })).toHaveCount(0);
  expect(errors).toEqual([]);
});
