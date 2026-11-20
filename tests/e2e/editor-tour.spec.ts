import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const KEY = 'tour.editor.v1';
const STEPS = 7;

test.use({ editorTourSeen: false });

const bubble = (page: Page) => page.getByTestId('tour-bubble');

async function insideViewport(page: Page): Promise<void> {
  const box = await bubble(page).boundingBox();
  const view = page.viewportSize();
  if (!box || !view) throw new Error('no bubble or viewport');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height + 0.5);
}

/** Clicks through every step; on each one the bubble is fully on screen and Next is reachable. */
async function walk(page: Page): Promise<void> {
  for (let i = 1; i <= STEPS; i += 1) {
    await expect(page.getByTestId('tour-count')).toHaveText(`Step ${i} of ${STEPS}`);
    await insideViewport(page);
    await expect(page.getByTestId('tour-next')).toBeInViewport();
    await page.getByTestId('tour-next').click();
  }
  await expect(bubble(page)).toHaveCount(0);
}

test('editor tutorial: opens on the first visit, walks every step and is remembered', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('./#/editor/new');
  await expect(bubble(page)).toBeVisible();
  await expect(page.getByTestId('tour-ring')).toBeVisible();
  await walk(page);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toContain('"done"');

  // Seen: a later visit stays quiet.
  await page.reload();
  await expect(page.getByTestId('editor-screen')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(bubble(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('editor tutorial: Skip is remembered, and ? brings it back', async ({ page }) => {
  await page.goto('./#/editor/new');
  await expect(bubble(page)).toBeVisible();
  await page.getByTestId('tour-skip').click();
  await expect(bubble(page)).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toContain('"skipped"');

  await page.reload();
  await expect(page.getByTestId('editor-screen')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(bubble(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Editor tutorial' }).click();
  await expect(bubble(page)).toBeVisible();
  await expect(page.getByTestId('tour-count')).toHaveText(`Step 1 of ${STEPS}`);
});

test('editor tutorial: works from the keyboard and does not block editing', async ({ page }) => {
  await page.goto('./#/editor/new');
  await expect(bubble(page)).toBeVisible();
  await expect(page.getByTestId('tour-next')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tour-count')).toHaveText(`Step 2 of ${STEPS}`);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tour-count')).toHaveText(`Step 3 of ${STEPS}`);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('tour-count')).toHaveText(`Step 2 of ${STEPS}`);

  // Editing keeps working while the bubble is open.
  const blocks = page.getByTestId('editor-block');
  const before = await blocks.count();
  await page.getByTestId('palette-steady').click();
  await expect(blocks).toHaveCount(before + 1);
  await expect(bubble(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(bubble(page)).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toContain('"skipped"');
});

for (const [name, size] of [
  ['phone portrait', { width: 390, height: 844 }],
  ['phone landscape', { width: 844, height: 390 }],
] as const) {
  test(`editor tutorial: every step fits on a ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('./#/editor/new');
    await expect(bubble(page)).toBeVisible();
    await walk(page);
  });
}
