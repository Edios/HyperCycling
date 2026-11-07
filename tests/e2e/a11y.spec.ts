import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// M24d: axe-core on every route and on the training screen, on a desktop and on a phone (touch,
// 390 px), with zero serious or critical violations. Pages build only (rides autosave to the shared
// local database, which would pop the resume prompt in other tests).

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 720, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
];

const ROUTES = [
  '#/',
  '#/plan',
  '#/plans',
  '#/plans/wizard',
  '#/freestyle',
  '#/players',
  '#/settings',
  '#/setup/demo-mixed',
  '#/editor/demo-mixed',
  '#/summary',
  '#/no-such-page',
];

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const vp of VIEWPORTS) {
  test.describe(`axe on ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch,
    });

    for (const route of ROUTES) {
      test(`${route} has no serious or critical violations`, async ({ page }, info) => {
        test.skip(info.project.name !== 'pages', 'runs on the pages build only');
        test.setTimeout(90_000); // axe walks every node; the workout list has a hundred rows
        await page.goto(`./${route}`);
        await page.reload();
        await expect(page.locator('body')).not.toBeEmpty();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        expect(await seriousViolations(page), route).toEqual([]);
      });
    }

    for (const theme of ['dark', 'light'] as const) {
      test(`training screen (${theme} Basic) has no serious or critical violations`, async ({
        page,
      }, info) => {
        test.skip(info.project.name !== 'pages', 'runs on the pages build only');
        test.setTimeout(60_000);
        if (theme === 'light') {
          await page.goto('./#/settings');
          await page.getByText(/^(Jasny|Light)$/).click();
        }
        await page.goto('./#/setup/demo-mixed');
        await page.getByRole('button', { name: /^(Start|Rozpocznij)$/ }).click();
        await expect(page.getByTestId('training-screen')).toBeVisible();
        await page.waitForTimeout(600);
        expect(await seriousViolations(page), 'start overlay').toEqual([]);
        await page.keyboard.press('Space');
        await expect(page.getByTestId('training-screen')).toHaveAttribute(
          'data-status',
          'running',
          { timeout: 8000 },
        );
        await page.waitForTimeout(500);
        expect(await seriousViolations(page), 'running').toEqual([]);
      });
    }
  });
}

test('keyboard focus is visible on every tab stop of the start page', async ({ page }, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  await page.goto('./#/');
  await page.reload();
  await expect(page.locator('body')).not.toBeEmpty();
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow };
    });
    if (!ring) continue;
    const visible = (ring.style !== 'none' && ring.width >= 2) || ring.shadow !== 'none';
    expect(visible, `tab stop #${i + 1}`).toBe(true);
  }
});
