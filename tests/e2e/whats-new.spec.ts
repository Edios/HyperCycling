import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

test("What's new: a quiet dot until it is opened, from How it works, with the version", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seedSettings(page, info, null);
  await page.goto('./#/');
  // A first visit: no dot (everything is new, nothing is new since last time).
  await expect(page.getByTestId('footer-whats-new')).toBeVisible();
  await expect(page.getByTestId('whats-new-dot')).toHaveCount(0);
  // After an update: the rider saw an older list.
  await page.evaluate(() => localStorage.setItem('hypercycling.whatsNew.seen', '1'));
  await page.reload();

  // The footer shows the version and a dot; no popup anywhere.
  const footer = page.getByTestId('footer-whats-new');
  await expect(footer).toContainText(/Version \d+\.\d+\.\d+/);
  await expect(page.getByTestId('home-footer').getByTestId('whats-new-dot')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByTestId('nav-how-it-works').click();
  await expect(page.getByTestId('nav-how-it-works').getByTestId('whats-new-dot')).toBeVisible();
  await page.getByTestId('guide-whats-new').click();

  await expect(page).toHaveURL(/#\/whats-new/);
  await expect(page.getByRole('heading', { level: 1, name: "What's new" })).toBeVisible();
  await expect(page.getByTestId('whats-new-version')).toContainText('Version');
  expect(await page.getByTestId('whats-new-day').count()).toBeGreaterThan(3);
  // Opening the page clears the dot, also after a reload.
  await expect(page.getByTestId('whats-new-dot')).toHaveCount(0);
  await page.reload();
  await page.goto('./#/');
  await expect(page.getByTestId('footer-whats-new')).toBeVisible();
  await expect(page.getByTestId('whats-new-dot')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("What's new in Polish, no horizontal scroll on a phone", async ({ page }, info) => {
  await seedSettings(page, info, null, { lang: 'pl' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/whats-new');
  await expect(page.getByRole('heading', { level: 1, name: 'Co nowego' })).toBeVisible();
  await expect(page.getByTestId('whats-new-version')).toContainText('Wersja');
  await expect(page.getByTestId('whats-new-older')).not.toHaveAttribute('open', '');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
