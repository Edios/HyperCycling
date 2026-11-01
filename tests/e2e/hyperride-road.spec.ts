import type { Page, TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expect, test } from './fixtures';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings';

// Starts a workout, so it autosaves a session: the fixture clears it before each test and the
// test clears it again at the end, which keeps the shared local database tidy.

async function requireWebgl(page: Page): Promise<void> {
  await page.goto('about:blank');
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  });
  test.skip(!webgl, 'WebGL is not available in this headless browser');
}

/** Stores settings through the storage the project's build uses (HTTP API or IndexedDB). */
async function seedSettings(page: Page, info: TestInfo, settings: Settings): Promise<void> {
  if (info.project.name.startsWith('local')) {
    const res = await page.request.put('/api/settings', { data: settings });
    expect(res.ok()).toBe(true);
    await page.goto('./');
    return;
  }
  await page.goto('./');
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

/** Counts distinct (coarsely quantised) colours in a PNG: a blank canvas has one or two. */
async function distinctColours(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 7) {
      seen.add(((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4));
    }
    return seen.size;
  }, png.toString('base64'));
}

async function startRoad(
  page: Page,
  info: TestInfo,
  quality: 'high' | 'low',
  world = 'Road',
): Promise<void> {
  await seedSettings(page, info, { ...DEFAULT_SETTINGS, hyperrideQuality: quality });
  await page.goto('./#/setup/demo-mixed');
  await page.getByRole('button', { name: /^World/ }).click();
  await page.getByRole('radio', { name: world }).click();
  await expect(page.getByRole('radio', { name: world })).toBeChecked();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
    timeout: 8000,
  });
}

test('Road world: starts from Setup, renders, and switches to Neon tunnel in quick settings', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await requireWebgl(page);

  await startRoad(page, info, 'high');
  const canvas = page.getByTestId('hyperride-canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15_000 })
    .toBeGreaterThan(300);
  await page.waitForTimeout(1200);
  expect(await distinctColours(page, await page.screenshot())).toBeGreaterThan(20);

  // The canvas is keyed by world: tag this element to see it replaced after the switch.
  await canvas.evaluate((c) => c.setAttribute('data-probe', 'road'));
  await page.mouse.move(600, 300); // the controls fade out while idle
  await page.getByRole('button', { name: 'Quick settings' }).click();
  await expect(page.getByRole('radio', { name: 'Road' })).toBeChecked();
  await page.getByRole('radio', { name: 'Neon tunnel' }).click();
  await expect(page.getByRole('radio', { name: 'Neon tunnel' })).toBeChecked();
  await expect(page.locator('[data-testid="hyperride-canvas"][data-probe="road"]')).toHaveCount(0);
  const next = page.getByTestId('hyperride-canvas');
  await expect(next).toHaveCount(1);
  await expect
    .poll(() => next.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15_000 })
    .toBeGreaterThan(300);
  await page.waitForTimeout(1200);
  expect(await distinctColours(page, await page.screenshot())).toBeGreaterThan(20);

  expect(errors).toEqual([]);
  if (info.project.name.startsWith('local')) {
    await page.request.delete('/api/active-session');
  }
});

test('Scenes world: starts from Setup and renders without console errors', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await requireWebgl(page);

  await startRoad(page, info, 'high', 'Scenes');
  const canvas = page.getByTestId('hyperride-canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15_000 })
    .toBeGreaterThan(300);
  await page.waitForTimeout(1200);
  expect(await distinctColours(page, await page.screenshot())).toBeGreaterThan(20);
  expect(errors).toEqual([]);
  if (info.project.name.startsWith('local')) {
    await page.request.delete('/api/active-session');
  }
});

// Screenshots for the owner (opt-in): SHOTS_DIR=<dir> npx playwright test hyperride-road ...
const shotsDir = process.env.SHOTS_DIR;
for (const quality of ['high', 'low'] as const) {
  for (const size of [
    { width: 412, height: 915 },
    { width: 1280, height: 720 },
  ]) {
    test(`Road world screenshot ${size.width}x${size.height} ${quality}`, async ({
      page,
    }, info) => {
      test.skip(!shotsDir, 'set SHOTS_DIR to capture screenshots');
      test.setTimeout(120_000);
      await requireWebgl(page);
      await page.setViewportSize(size);
      await startRoad(page, info, quality);
      await expect
        .poll(
          () => page.getByTestId('hyperride-canvas').evaluate((c: HTMLCanvasElement) => c.width),
          {
            timeout: 15_000,
          },
        )
        .toBeGreaterThan(300);
      await page.waitForTimeout(3000);
      mkdirSync(shotsDir!, { recursive: true });
      await page.screenshot({
        path: `${shotsDir}/road-${size.width}x${size.height}-${quality}.png`,
      });
      if (info.project.name.startsWith('local')) {
        await page.request.delete('/api/active-session');
      }
    });
  }
}
