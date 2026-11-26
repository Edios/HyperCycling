import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

// The simplified Experience flow: one series card, a lean setup ("Who is riding?" and Start), and
// the advanced settings as four named groups with a "?" under the rows that need an explanation.
// Nothing here starts a ride, so no sound is ever played.

const FLAG = 'hypercycling.setup.advanced';
const SHOTS = process.env.SHOTS_DIR;

// Pages build only: the local project shares one database between parallel tests.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'pages', 'pages build only: needs its own storage');
});

async function closedAccordion(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('exp-seeded') === null) {
      sessionStorage.setItem('exp-seeded', '1');
      localStorage.setItem(key, '0');
    }
  }, FLAG);
}

const noHorizontalScroll = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const [name, size] of [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 390, height: 844 }],
  ['phone-landscape', { width: 844, height: 390 }],
] as const) {
  test(`Experience: series card → lean setup → advanced groups (${name})`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await closedAccordion(page);
    await page.setViewportSize(size);
    await seedSettings(page, info, null, { bikeSetupDone: true });

    // One card for the whole Neon Grid series; its variants are one tap apart.
    await page.goto('./#/experiences');
    await expect(page.getByTestId('experience-card')).toHaveCount(1);
    const variants = page.getByRole('radiogroup', { name: 'Length and variant' });
    await expect(variants.getByRole('radio')).toHaveCount(3);
    await expect(page.getByTestId('experience-card')).not.toContainText('electronic');
    await variants.getByText('45 min', { exact: true }).click();
    await expect(page.getByTestId('experience-card')).toHaveAttribute(
      'data-experience',
      'neon-grid-45',
    );
    // A wide screen shows the scenario beside the card; narrower ones open it with the toggle.
    if (size.width < 1024) await page.getByRole('button', { name: 'Show scenario' }).click();
    await expect(page.getByTestId('experience-scenario-summary')).toHaveText(
      '45 min · 11 songs · peak 9',
    );
    await expect(page.getByTestId('experience-scenario').locator('li')).toHaveCount(11);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/experience-picker-${name}.png` });

    // Setup: the title and who rides; everything else waits in the closed accordion.
    await page.getByTestId('experience-start').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Neon Grid 45');
    await expect(page.getByRole('heading', { level: 2, name: 'Who is riding?' })).toBeVisible();
    const toggle = page.getByTestId('advanced-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('start-bar').getByTestId('start-status')).toContainText(
      /Music: .* · on/,
    );
    await expect(page.getByRole('switch', { name: 'Lite (weaker device)' })).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/experience-setup-closed-${name}.png` });

    // Advanced: four named groups, in order from the most to the least often changed.
    await toggle.click();
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      'Music',
      'Screen',
      'Coach',
      'Equipment',
    ]);
    // No riders switch, no layout tiles that wrap: one list for the layout.
    await expect(page.getByRole('switch', { name: 'Show riders' })).toHaveCount(0);
    const layout = page.getByRole('combobox', { name: 'Screen layout' });
    await expect(layout.locator('option')).toHaveCount(5);
    await layout.selectOption('focus');
    await expect(layout).toHaveValue('focus');

    // "?" explains in place and closes with Escape.
    const help = page.getByRole('button', { name: 'Help: Screen layout' });
    await help.click();
    await expect(
      page.getByRole('note').filter({ hasText: 'no room for the riders panel' }),
    ).toBeVisible();
    await help.press('Escape');
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Help: Check the music' }).click();
    await expect(page.getByRole('note').filter({ hasText: 'The test is silent' })).toBeVisible();

    // The rows keep a comfortable target and nothing leaves the screen.
    expect(await noHorizontalScroll(page)).toBe(true);
    for (const row of await page.getByRole('switch').all()) {
      const box = await row.locator('xpath=ancestor::label').boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/experience-setup-open-${name}.png` });
    expect(errors).toEqual([]);
  });
}
