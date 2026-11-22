import { expect, test } from './fixtures';

// The matched music is kept on the device (Soundtrack Match PR 5). Pages build only: its own
// IndexedDB per test.

async function toWizard(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('./#/freestyle');
  await page.getByRole('searchbox').fill('Climbs to Music');
  await page.getByTestId('workout-card').first().click();
  await page.getByTestId('workout-match-music').click();
  await expect(page.getByTestId('soundtrack-wizard')).toBeVisible();
}

test('the matched music is saved on the device: it is there after a reload, until it is removed', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  await toWizard(page);
  await page.getByTestId('soundtrack-next').click();
  await page.getByTestId('soundtrack-next').click();
  await page.getByRole('button', { name: 'To the ride' }).click();
  const row = page.getByTestId('setup-soundtrack');
  await expect(row).toHaveAttribute('data-state', 'ready');
  const text = await row.textContent();
  // A reload forgets the page, not the device: the songs are found again.
  await page.reload();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await expect(page.getByTestId('setup-soundtrack')).toHaveAttribute('data-state', 'ready');
  expect(await page.getByTestId('setup-soundtrack').textContent()).toContain(
    text?.match(/Matched: \d+ songs\./)?.[0] ?? 'Matched',
  );
  await expect(page.getByRole('switch', { name: 'Music in this ride' })).toBeEnabled();
  // Removing deletes the saved plan too.
  await page.getByTestId('setup-match-remove').click();
  await expect(page.getByTestId('setup-soundtrack')).toHaveAttribute('data-state', 'none');
  await page.reload();
  await expect(page.getByTestId('setup-soundtrack')).toHaveAttribute('data-state', 'none');
});
