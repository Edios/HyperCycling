import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

const SHOTS = process.env.SHOTS_DIR;

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('start page: short intro and three mode tiles with their own colours', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seedSettings(page, info, null);
  await page.goto('./#/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('How do you want to ride');
  await expect(page.getByTestId('home-hero')).toContainText('HyperCycling guides your indoor ride');
  await expect(page.locator('[data-tile="experience"]')).toContainText('Experience the immersion');
  const colours = await page
    .locator('[data-tile]')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).borderTopColor));
  expect(new Set(colours).size).toBe(3);
  await expect(
    page.getByTestId('home-footer').getByRole('link', { name: 'GetSongBPM' }),
  ).toHaveAttribute('href', 'https://getsongbpm.com');
  await shot(page, `home-fresh-${info.project.name}`);
  await page.locator('[data-tile="free"]').click();
  await expect(page).toHaveURL(/#\/freestyle/);
  expect(errors).toEqual([]);
});

test('active plan: Plan tile shows the next session and opens the plan', async ({ page }, info) => {
  await seedSettings(page, info, 'build-form');
  await page.goto('./#/');
  await expect(page.locator('[data-tile="plan"]')).toContainText(/week 1 of/i);
  await shot(page, `home-plan-${info.project.name}`);
  await page.locator('[data-tile="plan"]').click();
  await expect(page).toHaveURL(/#\/plan/);
});

test('tile art animates on hover and stands still with reduced motion', async ({ page }, info) => {
  await seedSettings(page, info, null);
  await page.goto('./#/');
  const bar = page.locator('[data-tile="free"] .part').first();
  const name = (): Promise<string> => bar.evaluate((e) => getComputedStyle(e).animationName);
  expect(await name()).toBe('none');
  await page.locator('[data-tile="free"]').hover();
  expect(await name()).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await name()).toBe('none');
});

test('phone: tiles stacked, no horizontal scroll', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSettings(page, info, 'build-form');
  await page.goto('./#/');
  await expect(page.locator('[data-tile="experience"]')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, `home-phone-${info.project.name}`);
});

test('footer: project info, source code, privacy and about links; no horizontal scroll at 360 px', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await seedSettings(page, info, null);
  await page.goto('./#/');
  const footer = page.getByTestId('home-footer');
  await expect(footer).toContainText('AGPL-3.0');
  await expect(footer.getByRole('link', { name: 'Source code' })).toHaveAttribute(
    'href',
    'https://github.com/Edios/HyperCycling',
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await footer.getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByTestId('about-legal')).toBeInViewport();
});

test('GetSongBPM link is in the static HTML source (no JS needed)', async ({ request }) => {
  const res = await request.get('./');
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain('<a href="https://getsongbpm.com"');
  expect(await res.text()).toContain('https://github.com/Edios/HyperCycling');
});
