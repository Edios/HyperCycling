import { expect, test, type Page } from '@playwright/test';

/** No screen may scroll sideways, on a small phone or on a laptop (editor toolbar included). */
const SIZES = [
  { width: 360, height: 800 },
  { width: 412, height: 915 },
  { width: 1280, height: 720 },
];

const ROUTES = [
  '#/',
  '#/plans',
  '#/freestyle',
  '#/players',
  '#/settings',
  '#/setup/demo-mixed',
  '#/editor/demo-mixed',
];

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth);
}

for (const size of SIZES) {
  test(`no horizontal scroll at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const route of ROUTES) {
      await page.goto(`./?dev${route}`);
      await page.reload();
      await expect(page.locator('body')).not.toBeEmpty();
      // Let fonts and layout settle before measuring.
      await page.waitForTimeout(300);
      expect(await noHorizontalScroll(page), `${route} at ${size.width}px`).toBe(true);
    }
  });
}

test('editor Save stays inside the viewport on desktop widths', async ({ page }) => {
  for (const width of [1280, 1366, 1920]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('./?dev#/editor/demo-mixed');
    await page.reload();
    const save = page.getByRole('button', { name: /Duplicate to edit|Save/ });
    await expect(save).toBeVisible();
    const box = await save.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    expect(await noHorizontalScroll(page)).toBe(true);
  }
});
