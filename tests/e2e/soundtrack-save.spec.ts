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

// Runs on both builds: the local one reads the plan from the server (/api, SQLite), the pages
// one from IndexedDB. No saved plan is the normal state and must not log an error.
test('a ride setup of a workout without a saved music plan logs no error in the console', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const requests: { url: string; status: number }[] = [];
  page.on('response', (r) => {
    if (r.url().includes('soundtrack-plans')) requests.push({ url: r.url(), status: r.status() });
  });
  await page.goto('./#/setup/music-climbs');
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await expect(page.getByTestId('setup-soundtrack')).toHaveAttribute('data-state', 'none');
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
  // On the local build the lookup is a real request and it is not a failed one.
  for (const r of requests) expect(r.status, r.url).toBeLessThan(400);
});

test('the matched music is saved on the device: it is there after a reload, until it is removed', async ({
  page,
}) => {
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
