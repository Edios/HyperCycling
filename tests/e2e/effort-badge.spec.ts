import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// R2: the "~85% FTP" effort name must never overlap the position badge, in any HUD layout, on
// desktop or a phone (pages build only: sessions autosave to the shared local database).

async function startRide(page: Page, background: RegExp): Promise<void> {
  await page.goto('./#/setup/demo-mixed');
  await page.getByRole('button', { name: background }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
    timeout: 8000,
  });
}

/** Gap in px between the bottom of the effort name and the top of the badge (negative = overlap). */
async function nameToBadgeGap(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const badge = document.querySelector('[data-testid="position-badge"]');
    const name = document.querySelector<HTMLElement>('[data-testid="effort-name"]');
    if (!name || !badge) return null;
    return badge.getBoundingClientRect().top - name.getBoundingClientRect().bottom;
  });
}

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 915, height: 412 },
  { width: 390, height: 844 },
];

for (const size of SIZES) {
  test(`effort name clears the position badge at ${size.width}x${size.height}`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    test.setTimeout(90_000);
    await page.setViewportSize(size);
    await startRide(page, /^World/);
    await page.evaluate(() => document.fonts.ready);
    for (let i = 0; i < 7; i += 1) {
      await page.waitForTimeout(250);
      const gap = await nameToBadgeGap(page);
      if (gap !== null) expect(gap, `layout #${i} at ${size.width}px`).toBeGreaterThanOrEqual(0);
      await page.keyboard.press('KeyH');
    }
  });
}
