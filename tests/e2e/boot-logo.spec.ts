import { expect, test } from './fixtures';

// The page before React starts (owner, 2026-11-26): on a visit without the brand intro (always so
// for automation), the still logo shows instead of the fallback text of #root, which stays for
// crawlers and visitors without JavaScript. React replaces all of #root when it starts.

const SHOTS = process.env.SHOTS_DIR;

test('before React starts: the still logo, not the fallback text', async ({ page }, info) => {
  // Hold the app's scripts back: the page stays as the HTML and public/intro-boot.js left it.
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-boot', '');
  // No intro for automation: the still logo is what shows.
  await expect(page.locator('html')).not.toHaveAttribute('data-intro', /.*/);
  const logo = page.locator('#boot-logo');
  await expect(logo).toBeVisible();
  await expect(logo.locator('.mark path')).toHaveCount(10);
  await expect(logo).toContainText('HyperCycling');
  await expect(page.locator('#root > .boot-seo')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'HyperCycling' })).toBeHidden();
  // Still: nothing on it animates.
  const animated = await logo.evaluate(
    (el) =>
      [el, ...el.querySelectorAll('*')].filter((x) => getComputedStyle(x).animationName !== 'none')
        .length,
  );
  expect(animated).toBe(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/boot-logo-${info.project.name}.png` });
});

test('React replaces the still logo when it starts', async ({ page }) => {
  await page.goto('./#/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('How do you want to ride');
  await expect(page.locator('#boot-logo')).toHaveCount(0);
  await expect(page.locator('.boot-seo')).toHaveCount(0);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the fallback text shows, the logo does not', async ({ page }, info) => {
    await page.goto('./');
    await expect(page.locator('html')).not.toHaveAttribute('data-boot', /.*/);
    await expect(page.getByRole('heading', { name: 'HyperCycling' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'GetSongBPM' })).toBeVisible();
    await expect(page.locator('#boot-logo')).toBeHidden();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/boot-nojs-${info.project.name}.png` });
  });
});
