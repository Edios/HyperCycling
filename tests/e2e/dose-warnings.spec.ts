import { expect, test } from './fixtures';

const SHOTS = process.env.SHOTS_DIR;

// "The Wall" has long standing climbs: a built-in example of a dosing note.
test('editor shows dosing notes without blocking, and a note selects its block', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('./#/editor/the-wall');
  await expect(page.getByTestId('editor-screen')).toBeVisible();

  const box = page.getByTestId('dose-warnings');
  await expect(box).toBeVisible();
  await expect(page.getByTestId('dose-count')).toContainText(/\d/);
  await box.locator('summary').click();
  const items = page.getByTestId('dose-item');
  await expect(items.first()).toBeVisible();
  await expect(page.getByTestId('dose-item').filter({ hasText: /Standing for/ })).not.toHaveCount(
    0,
  );
  // The gentle toggle only changes thresholds, never hides the list.
  await page.getByLabel(/Gentle limits/).check();
  await expect(items.first()).toBeVisible();
  await page.getByLabel(/Gentle limits/).uncheck();

  // Picking a note selects its block in the timeline.
  await items.first().getByRole('button').click();
  await expect(
    page.locator('[data-testid="editor-block"][data-selected="true"]').first(),
  ).toBeVisible();

  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/dose-warnings-${page.viewportSize()?.width}.png` });
  expect(errors).toEqual([]);
});

test('editor dosing notes at a phone width keep the page from scrolling sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/editor/the-wall');
  await page.getByTestId('dose-warnings').locator('summary').click();
  await expect(page.getByTestId('dose-item').first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dose-warnings-390.png` });
});
