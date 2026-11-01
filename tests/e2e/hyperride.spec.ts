import { expect, test } from '@playwright/test';

test('dev Hyperride renders the Neon Tunnel without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('about:blank');
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  });
  test.skip(!webgl, 'WebGL is not available in this headless browser');

  await page.goto('./#/dev/hyperride?t=150');
  const canvas = page.getByTestId('hyperride-canvas');
  await expect(canvas).toBeVisible();
  // the world draws into the canvas: wait until it has a backing buffer of the page size
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15_000 })
    .toBeGreaterThan(300);
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});
