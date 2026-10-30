import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';

/**
 * Stores settings through whichever storage the project's build uses: the local server's
 * HTTP API, or IndexedDB for the Pages build.
 */
let original: { had: boolean; value?: unknown } | undefined;

test.afterEach(async ({ request }, info) => {
  // The local server keeps real data: put back whatever settings it had before seeding.
  if (info.project.name !== 'local' || !original) return;
  if (original.had) await request.put('/api/settings', { data: original.value });
  else await request.delete('/api/settings');
  original = undefined;
});

async function seedSettings(
  page: Page,
  info: TestInfo,
  activePlanId: string | null,
): Promise<void> {
  const settings = { ...DEFAULT_SETTINGS, ...(activePlanId ? { activePlanId } : {}) };
  await page.goto('./');
  // The empty Plan tab only renders once the app has opened (and created) its storage.
  await expect(page.getByRole('link', { name: 'Choose a plan' })).toBeVisible();
  if (info.project.name === 'local') {
    if (!original) {
      const before = await page.request.get('/api/settings');
      const text = before.ok() ? (await before.text()).trim() : '';
      original = text && text !== 'null' ? { had: true, value: JSON.parse(text) } : { had: false };
    }
    const res = await page.request.put('/api/settings', { data: settings });
    expect(res.ok()).toBe(true);
    return;
  }
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('spinning-tutor');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('singletons', 'readwrite');
          tx.objectStore('singletons').put(value, 'settings');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    settings,
  );
}

test('plan tab with an active plan: Ride starts the training screen', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await seedSettings(page, info, 'build-form');
  await page.reload();
  await expect(page.getByTestId('next-session')).toBeVisible();
  await expect(page.getByTestId('weeks-list').getByRole('listitem')).toHaveCount(8);
  await expect(page.getByTestId('plan-done')).toContainText('0 of');

  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'idle');
  expect(errors).toEqual([]);
});

test('without an active plan the Plan tab offers to choose one', async ({ page }, info) => {
  await seedSettings(page, info, null);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Choose a plan' })).toBeVisible();
});

test('freestyle tab filters and searches', async ({ page }) => {
  await page.goto('./#/freestyle');
  const cards = page.getByTestId('workout-card');
  await expect(cards.first()).toBeVisible();
  const all = await cards.count();
  await page.getByRole('button', { name: 'HIIT' }).click();
  const hiit = await cards.count();
  expect(hiit).toBeGreaterThan(0);
  expect(hiit).toBeLessThan(all);
  await page.getByRole('button', { name: 'All' }).click();
  await page.getByRole('searchbox').fill('tabata');
  await expect(cards.first()).toContainText(/tabata/i);
  await cards.first().click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
});
