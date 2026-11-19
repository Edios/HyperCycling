import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

const SHOTS = process.env.SHOTS_DIR;

for (const [name, size] of [
  ['desktop', { width: 1280, height: 720 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`Experience in the top nav (${name}): link, active state, readable scenario`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewportSize(size);
    await seedSettings(page, info, null);
    await page.goto('./#/plan');
    const link = page.getByTestId('nav-experience');
    await expect(link).toBeVisible();
    await expect(link).not.toHaveAttribute('aria-current', 'page');
    // all three tabs stay inside the viewport
    const box = await link.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    await link.click();
    await expect(page.getByTestId('experience-picker')).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('nav-experience')).toBeVisible();

    const card = page.locator('[data-experience="neon-grid-30"]');
    const scenario = card.getByTestId('experience-scenario');
    await expect(scenario).toHaveCount(0); // collapsed by default
    await card.getByRole('button', { name: /scenario|scenariusz/i }).click();
    await expect(scenario).toBeVisible();
    await expect(scenario.locator('li').first()).toContainText(/\d+:\d\d/);
    await expect(scenario.locator('li').first()).toContainText(/\d\/10/);
    const sbox = await scenario.boundingBox();
    expect(sbox!.x + sbox!.width).toBeLessThanOrEqual(size.width);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/experience-${name}.png` });
    expect(errors).toEqual([]);
  });
}
