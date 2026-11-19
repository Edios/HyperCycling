import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

const SHOTS = process.env.SHOTS_DIR;

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test('menu shows How it works and the page opens without console errors', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await seedSettings(page, info, null);
  await page.goto('./#/');
  const link = page.getByTestId('nav-how-it-works');
  await expect(link).toBeVisible();
  await expect(link).toHaveAccessibleName('How it works');
  await link.click();
  await expect(page).toHaveURL(/#\/how-it-works/);
  await expect(page.getByTestId('how-it-works')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('You pedal');
  for (const name of ['Plan', 'Freestyle', 'Experience', 'Editor', 'Open source (MIT)']) {
    await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'See the code on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/Edios/HyperCycling',
  );
  await expect(link).toHaveAttribute('aria-current', 'page');
  await shot(page, `how-it-works-${info.project.name}`);
  await page.getByRole('link', { name: 'Choose a ride' }).click();
  await expect(page).toHaveURL(/#\/$/);
  expect(errors).toEqual([]);
});

test('page has no horizontal scroll on a phone, portrait and landscape', async ({ page }, info) => {
  await seedSettings(page, info, null);
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('./#/how-it-works');
    await expect(page.getByTestId('how-it-works')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${size.width}x${size.height}`).toBeLessThanOrEqual(0);
    await shot(page, `how-it-works-${size.width}x${size.height}-${info.project.name}`);
  }
});
