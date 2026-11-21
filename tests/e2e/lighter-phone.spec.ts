import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Lighter phone layouts (UI audit N-01, N-03, N-04): the ride HUD in portrait, the fixed bars in
// landscape and the editor header. Pages build only (rides autosave to the shared local database).

async function startExperience(page: Page): Promise<void> {
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
}

test.describe('HUD on a phone in portrait (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the controls are one row of big buttons under the NEXT bar, above the chart', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    await startExperience(page);
    const controls = page.getByTestId('controls');
    await expect(controls).toBeVisible();
    // Previous block and fullscreen are left out on a phone.
    await expect(page.getByRole('button', { name: 'Previous block' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeHidden();
    const boxes = await controls.getByRole('button').evaluateAll((els) =>
      els
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0)
        .map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width })),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(4);
    // One row: every button starts within 3 px of the first; all stay on screen and a thumb wide.
    for (const b of boxes) {
      expect(Math.abs(b.top - boxes[0]!.top)).toBeLessThanOrEqual(3);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(390);
      expect(b.w).toBeGreaterThanOrEqual(44);
    }
    // The chart (timeline) starts below the controls.
    const chart = await page.getByTestId('timeline').boundingBox();
    expect(chart).not.toBeNull();
    expect(Math.max(...boxes.map((b) => b.bottom))).toBeLessThanOrEqual(chart!.y + 2);
  });

  test('NEXT is a bar under the ring and the sensor row has no frame', async ({ page }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    await startExperience(page);
    const ring = await page.getByTestId('effort-ring-box').boundingBox();
    const next = await page.getByTestId('next-block').boundingBox();
    expect(ring).not.toBeNull();
    expect(next).not.toBeNull();
    // Under the ring, not beside it, and a slim bar rather than a column.
    expect(next!.y).toBeGreaterThanOrEqual(ring!.y + ring!.height - 4);
    expect(next!.height).toBeLessThan(ring!.height * 0.5);
    const frame = await page
      .getByTestId('rpm-value')
      .evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
    expect(frame).toBe(0);
  });

  test('a toast stacks above the controls, not over the chart', async ({ page }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    await startExperience(page);
    const top = await page.getByTestId('controls').boundingBox();
    expect(top).not.toBeNull();
    const stackBottom = await page
      .getByTestId('toast-stack')
      .evaluate((el) => parseFloat(getComputedStyle(el).bottom));
    // The stack's bottom edge is above the top of the controls (viewport height 844).
    expect(844 - stackBottom).toBeLessThanOrEqual(top!.y);
  });
});

test.describe('fixed bars on a phone in landscape (844x390)', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('the app bar and the Start bar leave most of the height to the content', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
    const startBar = page.getByTestId('start-bar');
    await expect(startBar).toBeVisible();
    const bar = await page.locator('header, [data-testid="app-bar"]').first().boundingBox();
    const start = await startBar.boundingBox();
    expect(bar).not.toBeNull();
    expect(start).not.toBeNull();
    // Together under a quarter of the screen (they were a third).
    expect(bar!.height + start!.height).toBeLessThanOrEqual(390 * 0.27);
  });

  test('home shows the three modes without scrolling to them', async ({ page }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    await page.goto('./#/');
    for (const mode of ['plan', 'free', 'world']) {
      const tile = page.locator(`[data-mode="${mode}"]`).first();
      await expect(tile).toBeInViewport({ ratio: 0.9 });
    }
  });
});

test.describe('editor header on a phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('name and Save share the first row; the rest fits one more row', async ({ page }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    await page.goto('./#/editor/new');
    await expect(page.getByTestId('editor-screen')).toBeVisible();
    const name = await page.getByRole('textbox', { name: /name/i }).first().boundingBox();
    const save = await page.getByRole('button', { name: 'Save', exact: true }).boundingBox();
    const header = await page.locator('header').first().boundingBox();
    expect(name).not.toBeNull();
    expect(save).not.toBeNull();
    expect(header).not.toBeNull();
    expect(Math.abs(name!.y - save!.y)).toBeLessThanOrEqual(12);
    expect(name!.width).toBeGreaterThanOrEqual(160);
    // Two rows of at most ~56 px each, plus padding.
    expect(header!.height).toBeLessThanOrEqual(135);
    // No orphan "Music" label over an empty lane.
    await expect(page.locator('main').getByText('Music', { exact: true })).toHaveCount(0);
  });
});
