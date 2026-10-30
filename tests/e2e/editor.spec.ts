import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const ZWO = path.join(process.cwd(), 'src/domain/parsers/__fixtures__/normal.zwo');

async function openMine(page: Page, name: string) {
  await page.goto('./#/freestyle');
  await page.getByRole('button', { name: 'Mine' }).click();
  const card = page.getByTestId('workout-card').filter({ hasText: name });
  await expect(card).toBeVisible();
  return card;
}

test('editor: new workout, palette blocks, keyboard resize, save, then ride it', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const name = `E2E Ride ${Date.now()}`;

  await page.goto('./#/freestyle');
  await page.getByRole('button', { name: /New workout/ }).click();
  await expect(page.getByTestId('editor-screen')).toBeVisible();
  const blocks = page.getByTestId('editor-block');
  await expect(blocks).toHaveCount(3);
  await page.getByLabel('Workout name').fill(name);

  await page.getByTestId('palette-steady').click();
  await expect(blocks).toHaveCount(4);
  await page.getByTestId('palette-cooldown').click();
  await expect(blocks).toHaveCount(5);
  // The cool-down is selected; resize it with the keyboard.
  const last = blocks.nth(4);
  await expect(last).toHaveAttribute('data-duration', '300');
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await expect(last).toHaveAttribute('data-duration', '330');
  await page.keyboard.press('Shift+-');
  await expect(last).toHaveAttribute('data-duration', '325');
  await page.keyboard.press('Control+z');
  await expect(last).toHaveAttribute('data-duration', '330');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(page).toHaveURL(/#\/editor\/(?!new)/);

  const card = await openMine(page, name);
  await card.click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  expect(errors).toEqual([]);
});

test('editor: dragging the right edge changes the duration in 15 s steps', async ({ page }) => {
  await page.goto('./#/editor/new');
  const blocks = page.getByTestId('editor-block');
  await blocks.nth(1).click();
  await expect(blocks.nth(1)).toHaveAttribute('data-duration', '600');
  const handle = page.getByRole('slider', { name: 'Change duration' });
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle not visible');
  const lane = await page.getByTestId('editor-timeline').boundingBox();
  if (!lane) throw new Error('timeline not visible');
  const secPerPx = 1200 / (lane.width - 24);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120 / secPerPx, box.y + box.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  const after = Number(await blocks.nth(1).getAttribute('data-duration'));
  expect(after).toBeGreaterThan(600);
  expect(after % 15).toBe(0);
});

test('editor: leaving with unsaved changes asks first', async ({ page }) => {
  await page.goto('./#/editor/new');
  await page.getByTestId('palette-steady').click();
  await page.getByRole('link', { name: '‹ Freestyle' }).click();
  await expect(page.getByRole('dialog')).toContainText('unsaved changes');
  await page.getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByTestId('editor-screen')).toBeVisible();
  await page.getByRole('link', { name: '‹ Freestyle' }).click();
  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/#\/freestyle/);
});

test('import: a .zwo file opens in the editor and can be saved', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const name = `E2E Import ${Date.now()}`;

  await page.goto('./#/freestyle');
  await page.getByRole('button', { name: 'Import file' }).click();
  await page.getByTestId('import-input').setInputFiles(ZWO);
  const result = page.getByTestId('import-result');
  await expect(result).toContainText('Test Ladder');
  await result.getByRole('button', { name: 'Open in editor' }).click();

  await expect(page.getByTestId('editor-screen')).toBeVisible();
  await expect(page.getByLabel('Workout name')).toHaveValue('Test Ladder');
  // Warm-up, steady, repeat (4 × 2 bars), ramp, free ride, cool-down.
  expect(await page.getByTestId('editor-block').count()).toBeGreaterThanOrEqual(6);
  await expect(page.getByTestId('editor-repeat')).toBeVisible();

  await page.getByLabel('Workout name').fill(name);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

  await openMine(page, name);
  expect(errors).toEqual([]);
});

test('built-in workouts open read-only and can be duplicated to edit', async ({ page }) => {
  await page.goto('./#/freestyle');
  const first = page.getByTestId('workout-card').first();
  const href = await first.getAttribute('href');
  const id = href?.split('/').pop();
  await page.goto(`./#/editor/${id}`);
  await expect(page.getByTestId('editor-screen')).toHaveAttribute('data-readonly', 'true');
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Duplicate to edit' }).click();
  await expect(page.getByTestId('editor-screen')).toHaveAttribute('data-readonly', 'false');
  await expect(page.getByLabel('Workout name')).toHaveValue(/\(copy\)$/);
});
