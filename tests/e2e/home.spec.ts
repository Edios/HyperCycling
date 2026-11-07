import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

const SHOTS = process.env.SHOTS_DIR;

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('fresh profile: hero offers a gentle workout and a way to build a plan', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seedSettings(page, info, null);
  await page.goto('./#/');
  await expect(page.getByTestId('home-ride')).toBeVisible();
  await expect(page.getByTestId('home-tunnel')).toBeVisible();
  await expect(
    page.getByTestId('home-footer').getByRole('link', { name: 'GetSongBPM' }),
  ).toHaveAttribute('href', 'https://getsongbpm.com');
  await expect(page.getByTestId('home-secondary')).toHaveAttribute('href', /plans\/wizard/);
  await expect(page.getByRole('button', { name: /Experience/ })).toBeEnabled();
  await shot(page, `home-fresh-${info.project.name}`);
  await page.getByTestId('home-ride').click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  expect(errors).toEqual([]);
});

test('active plan: hero shows the next session, Ride opens its setup', async ({ page }, info) => {
  await seedSettings(page, info, 'build-form');
  await page.goto('./#/');
  await expect(page.getByTestId('home-kicker')).toContainText(/week 1 of/i);
  await shot(page, `home-plan-${info.project.name}`);
  await page.getByTestId('home-ride').click();
  await expect(page.getByTestId('setup-badge')).toContainText('week 1');
});

test('Freestyle tile switches the hero and the secondary action', async ({ page }, info) => {
  await seedSettings(page, info, 'build-form');
  await page.goto('./#/');
  await page.getByRole('button', { name: /Freestyle/ }).click();
  await expect(page.getByTestId('home')).toHaveAttribute('data-mode', 'free');
  await expect(page.getByTestId('home-secondary')).toHaveAttribute('href', /freestyle/);
  await shot(page, `home-free-${info.project.name}`);
});

test('phone: hero above a stacked dock, no horizontal scroll', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSettings(page, info, 'build-form');
  await page.goto('./#/');
  await expect(page.getByTestId('home-ride')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const heroBox = await page.getByTestId('home-hero').boundingBox();
  const dockBox = await page.getByRole('group', { name: /ways to ride/i }).boundingBox();
  expect(heroBox!.y + heroBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
  await shot(page, `home-phone-${info.project.name}`);
});

test('GetSongBPM link is in the static HTML source (no JS needed)', async ({ request }) => {
  const res = await request.get('./');
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain('<a href="https://getsongbpm.com"');
});

test('Experience tile: hero offers Neon Grid, scenario picker and Setup with the scene preset', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seedSettings(page, info, null);
  await page.goto('./#/');
  await page.locator('[data-tile="experience"]').click();
  await expect(page.getByTestId('home-kicker')).toHaveText('Experience');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Neon Grid');
  // geometry: the call-to-action buttons stay inside the viewport and do not overlap
  const ride = await page.getByTestId('home-ride').boundingBox();
  const more = await page.getByTestId('home-secondary').boundingBox();
  const vp = page.viewportSize()!;
  for (const b of [ride, more]) {
    expect(b).not.toBeNull();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(vp.width);
    expect(b!.y + b!.height).toBeLessThanOrEqual(vp.height);
  }
  const apart =
    ride!.x + ride!.width <= more!.x ||
    more!.x + more!.width <= ride!.x ||
    ride!.y + ride!.height <= more!.y ||
    more!.y + more!.height <= ride!.y;
  expect(apart).toBe(true);

  await page.getByTestId('home-secondary').click();
  await expect(page.getByTestId('experience-picker')).toBeVisible();
  const card = page.getByTestId('experience-card').first();
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
  await page.getByTestId('experience-start').first().click();
  await expect(page.getByTestId('setup-experience')).toContainText('Neon Grid');
  expect(errors).toEqual([]);
});
