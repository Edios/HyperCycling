import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';

/** Stores settings through the storage the project's build uses (HTTP API or IndexedDB) and loads the app. */
async function seedSettings(page: Page, info: TestInfo, activePlanId: string): Promise<void> {
  const settings = { ...DEFAULT_SETTINGS, activePlanId };
  if (info.project.name.startsWith('local')) {
    const res = await page.request.put('/api/settings', { data: settings });
    expect(res.ok()).toBe(true);
    await page.goto('./');
    return;
  }
  await page.goto('./');
  await expect(
    page.getByRole('link', { name: 'Choose a plan' }).or(page.getByTestId('next-session')),
  ).toBeVisible();
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

/** True once an interrupted session has been persisted by the training screen. */
async function hasActiveSession(page: Page, info: TestInfo): Promise<boolean> {
  if (info.project.name.startsWith('local')) {
    return (await page.request.get('/api/active-session')).status() === 200;
  }
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('spinning-tutor');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result
            .transaction('singletons', 'readonly')
            .objectStore('singletons')
            .get('activeSession');
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result !== undefined);
          };
          get.onerror = () => reject(get.error);
        };
      }),
  );
}

test('Ride opens setup; Start rides it; reload mid-session offers Resume at the same block', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.clock.install();
  await seedSettings(page, info, 'build-form');
  await page.getByRole('button', { name: 'Ride', exact: true }).click();

  const setup = page.getByTestId('setup-screen');
  await expect(setup).toBeVisible();
  await expect(setup.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('setup-badge')).toContainText('Progres · week 1');
  await expect(page.getByRole('radio', { name: 'Solo' })).toBeChecked();
  await expect(page.getByRole('button', { name: /Hyperride/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /YouTube/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const training = page.getByTestId('training-screen');
  await expect(training).toHaveAttribute('data-status', 'idle');
  await page.keyboard.press('Space');
  await page.clock.runFor(3200);
  await expect(training).toHaveAttribute('data-status', 'running');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('block-timer')).toContainText('block 2 of');
  const timer = (await page.getByTestId('block-timer').textContent()) ?? '';
  await page.keyboard.press('Space');
  await expect(training).toHaveAttribute('data-status', 'paused');
  await expect.poll(() => hasActiveSession(page, info)).toBe(true);

  await page.reload();
  const prompt = page.getByTestId('resume-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Finish the session?');
  await expect(page.getByTestId('resume-progress')).toContainText('Block 2 of');
  await prompt.getByRole('button', { name: 'Resume' }).click();

  await expect(training).toBeVisible();
  await expect(training).toHaveAttribute('data-status', 'paused');
  await expect(page.getByTestId('block-timer')).toContainText('block 2 of');
  expect(timer).toContain('block 2 of');

  // Ending the workout forgets the stored session, so later tests start clean.
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('button', { name: 'End' }).click();
  await expect(page.getByTestId('summary-screen')).toBeVisible();
  await expect.poll(() => hasActiveSession(page, info)).toBe(false);
  expect(errors).toEqual([]);
});

test('Discard on the resume prompt forgets the session', async ({ page }, info) => {
  await page.clock.install();
  await seedSettings(page, info, 'build-form');
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.keyboard.press('Space');
  await page.clock.runFor(3200);
  await page.keyboard.press('Space');
  await expect.poll(() => hasActiveSession(page, info)).toBe(true);

  await page.reload();
  await page.getByTestId('resume-prompt').getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId('resume-prompt')).toBeHidden();
  await expect.poll(() => hasActiveSession(page, info)).toBe(false);
  await page.reload();
  await expect(page.getByTestId('resume-prompt')).toBeHidden();
});

test('plan ride to the summary counts toward the plan; the Plan tab shows it done', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.clock.install();
  await seedSettings(page, info, 'build-form');
  await expect(page.getByTestId('week-1-progres')).toHaveAttribute('data-status', 'open');
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const training = page.getByTestId('training-screen');
  await expect(training).toHaveAttribute('data-status', 'idle');
  await page.keyboard.press('Space');
  await page.clock.runFor(3200);
  await expect(training).toHaveAttribute('data-status', 'running');
  await page.clock.fastForward(4 * 3_600_000);

  await expect(page.getByTestId('summary-screen')).toBeVisible();
  await expect(page.getByTestId('summary-status')).toHaveText('Completed');
  await expect(page.getByRole('switch', { name: 'Count toward plan' })).toBeChecked();
  await expect(page.getByTestId('count-detail')).toContainText('week 1 · Progres');

  await page.getByRole('button', { name: 'Back to plan' }).click();
  await expect(page.getByTestId('week-1-progres')).toHaveAttribute('data-status', 'done');
  expect(errors).toEqual([]);

  // Leave the shared local database as it was for the tests that follow.
  if (info.project.name.startsWith('local')) {
    const res = await page.request.delete('/api/plan-progress/build-form');
    expect(res.ok()).toBe(true);
  }
});
