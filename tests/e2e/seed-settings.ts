import type { Page, TestInfo } from '@playwright/test';
import { expect } from './fixtures';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings';

/**
 * Stores settings (and loads the app with them) through whichever storage the project's build uses: the local server's
 * HTTP API, or IndexedDB for the Pages build.
 */
export async function seedSettings(
  page: Page,
  info: TestInfo,
  activePlanId: string | null,
  extra: Partial<Settings> = {},
): Promise<void> {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(activePlanId ? { activePlanId } : {}),
    ...extra,
  };
  if (info.project.name.startsWith('local')) {
    const res = await page.request.put('/api/settings', { data: settings });
    expect(res.ok()).toBe(true);
    await page.goto('./#/plan');
    return;
  }
  await page.goto('./#/plan');
  // Either Plan tab state means the app has opened (and created) its IndexedDB storage.
  await expect(page.getByTestId('plan-empty').or(page.getByTestId('next-session'))).toBeVisible();
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
  await page.reload();
}
