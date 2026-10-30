import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Sessions autosave to the shared local database, so the local projects would collide with each
// other; the pages build has its own IndexedDB per test and runs this on its own.

async function requireWebgl(page: Page): Promise<void> {
  await page.goto('about:blank');
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  });
  test.skip(!webgl, 'WebGL is not available in this headless browser');
}

async function startHyperride(page: Page, withPlayer: boolean): Promise<void> {
  await page.goto('./#/setup/demo-mixed');
  await page.getByRole('button', { name: /Hyperride/ }).click();
  await expect(page.getByRole('radio', { name: 'Immersive' })).toBeChecked();
  if (withPlayer) {
    await page.getByRole('button', { name: '+ Add' }).click();
    const form = page.getByTestId('add-player-form');
    await form.getByLabel('Name').fill('Mirek');
    await form.getByLabel('FTP (W)').fill('250');
    await form.getByRole('button', { name: 'Add rider' }).click();
    await expect(page.getByRole('radio', { name: 'Cockpit' })).toBeDisabled();
  }
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
}

test('Hyperride: canvas renders under the HUD, H cycles layouts, G toggles players', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await requireWebgl(page);
  await page.setViewportSize({ width: 1920, height: 1080 });

  await startHyperride(page, true);
  const canvas = page.getByTestId('hyperride-canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15_000 })
    .toBeGreaterThan(300);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
    timeout: 8000,
  });
  const shot = async (name: string): Promise<void> => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
  };

  // With a rider: Immersive and Column show players, H skips Cockpit and Tunnel time.
  await expect(page.getByTestId('layout-immersive')).toBeVisible();
  await expect(page.getByTestId('players-list')).toBeVisible();
  await shot('immersive-players');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-column')).toBeVisible();
  await expect(page.getByTestId('players-list')).toBeVisible();
  await shot('column-players');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-immersive')).toBeVisible();

  // G hides the rider: all four layouts are reachable.
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('players-list')).toHaveCount(0);
  await shot('immersive');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-column')).toBeVisible();
  await shot('column');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-cockpit')).toBeVisible();
  await shot('cockpit');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-tunnel')).toBeVisible();
  await shot('tunnel-time');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-immersive')).toBeVisible();

  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('players-list')).toBeVisible();
  expect(errors).toEqual([]);
});
