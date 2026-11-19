import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { seedSettings } from './seed-settings';

// The ride setup: one question ("Who is riding?"), the rest in "Advanced settings", and a sticky Start bar.
// Nothing here starts a ride, so no sound is ever played.

const FLAG = 'hypercycling.setup.advanced';

// Pages build only (like a11y.spec): the local project shares one database between parallel tests,
// and settings tests there switch the UI language and reset settings while these tests run. Here
// every test has its own storage, so the screen's defaults are what these tests see.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'pages', 'pages build only: needs its own storage');
});

/** Starts every page with the accordion closed (the shared fixture opens it for the other specs). */
async function closedAccordion(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    // Only on the first load of the tab, so a reload shows what the rider left behind.
    if (sessionStorage.getItem('flow-seeded') === null) {
      sessionStorage.setItem('flow-seeded', '1');
      localStorage.setItem(key, '0');
    }
  }, FLAG);
}

async function toEnd(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

test.describe('phone 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('only "Who is riding?" and Start up front; the options wait in a remembered accordion', async ({
    page,
  }) => {
    await closedAccordion(page);
    await page.goto('./#/setup/demo-mixed');
    const setup = page.getByTestId('setup-screen');
    await expect(setup).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Who is riding?' })).toBeVisible();

    const toggle = page.getByTestId('advanced-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('switch', { name: 'Beeps' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const group of ['Music', 'Screen', 'Coach', 'Equipment']) {
      await expect(page.getByRole('heading', { level: 3, name: group })).toBeVisible();
    }
    await expect(page.getByRole('switch', { name: 'Beeps' })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.reload();
    await expect(page.getByTestId('advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('Start sits in a bar at the bottom of the screen, wherever the page is scrolled', async ({
    page,
  }) => {
    await closedAccordion(page);
    await page.goto('./#/setup/demo-mixed');
    const bar = page.getByTestId('start-bar');
    await expect(bar).toBeVisible();
    const bottomOf = async (): Promise<number> => {
      const box = await bar.boundingBox();
      return Math.round((box?.y ?? 0) + (box?.height ?? 0));
    };
    expect(await bottomOf()).toBe(844);

    await page.getByTestId('advanced-toggle').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await bottomOf()).toBe(844);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await bottomOf()).toBe(844);
    await expect(bar.getByRole('button', { name: 'Start' })).toBeInViewport();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  for (const [name, route] of [
    ['Freestyle', '#/setup/demo-mixed'],
    ['Experience', '#/setup/class-neon-grid-45?exp=neon-grid-45'],
  ] as const) {
    test(`${name} setup, closed and open, has no serious or critical axe violations`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await closedAccordion(page);
      await page.goto(`./${route}`);
      await expect(page.getByTestId('setup-screen')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // Axe judges target sizes by what overlaps what. With the page scrolled to the end the sticky
      // bar rests in its own place and covers nothing; higher up it always covers whatever is
      // scrolled beneath it, which depends on the font (CI vs a laptop) and is not a defect.
      await toEnd(page);
      expect(await seriousViolations(page), 'closed').toEqual([]);
      await page.getByTestId('advanced-toggle').click();
      await expect(page.getByRole('heading', { level: 3, name: 'Coach' })).toBeVisible();
      await toEnd(page);
      expect(await seriousViolations(page), 'open').toEqual([]);
    });
  }

  test('shortcuts: music on/off, layout and More work without opening the accordion', async ({
    page,
  }) => {
    await closedAccordion(page);
    await page.goto('./#/setup/demo-mixed');
    const bar = page.getByTestId('start-bar');
    await expect(bar).toBeVisible();

    // demo-mixed has no pinned tracks: the music shortcut says so by being off and disabled.
    await expect(bar.getByTestId('bar-music')).toBeDisabled();

    await bar.getByTestId('bar-layout').click();
    const dialog = page.getByRole('dialog', { name: 'Screen layout' });
    await expect(dialog).toBeVisible();
    await dialog.getByText('Focus', { exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(bar.getByTestId('bar-layout')).toContainText('Focus');

    await bar.getByTestId('bar-more').click();
    await expect(page.getByTestId('advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('radio', { name: 'Focus' })).toBeChecked();
  });
});

test('Experience: music is on by default, one status line above Start, no shortcuts', async ({
  page,
}) => {
  await closedAccordion(page);
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await expect(page.getByTestId('setup-experience')).toBeVisible();
  const bar = page.getByTestId('start-bar');
  // The source is YouTube unless Spotify is connected (the local project shares its database).
  await expect(bar.getByTestId('start-status')).toContainText(/Music: (YouTube|Spotify|Auto) · on/);
  await expect(bar.getByTestId('bar-music')).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Start' })).toBeEnabled();

  // "Check the music" is optional and lives in the accordion, with its status.
  await expect(page.getByTestId('exp-check')).toHaveCount(0);
  await page.getByTestId('advanced-toggle').click();
  await expect(page.getByTestId('exp-check')).toBeVisible();
  await expect(page.getByTestId('exp-check-notrun')).toBeVisible();
  await page.getByRole('switch', { name: 'Music in this ride' }).uncheck({ force: true });
  await expect(bar.getByTestId('start-status')).toContainText('Music is off');
});

test('a manual-knob bike is never asked for watts when adding a rider', async ({ page }, info) => {
  await closedAccordion(page);
  await seedSettings(page, info, null, {
    equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
    bikeSetupDone: true,
  });
  await page.goto('./#/setup/demo-mixed');
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('Name')).toBeVisible();
  await expect(page.getByLabel('FTP (W)')).toHaveCount(0);
  await page.getByLabel('Name').fill('Kasia');
  await page.getByRole('button', { name: 'Add rider' }).click();
  const chip = page.getByRole('button', { name: 'Kasia' });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).not.toContainText(' W');
  await expect(page.getByText('Bike: Manual knob')).toBeVisible();
});

/**
 * Presses Tab through the whole page and returns every focused control that sits under the sticky
 * Start bar (WCAG 2.4.11 Focus Not Obscured).
 */
async function obscuredByBar(page: Page): Promise<string[]> {
  const bad: string[] = [];
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const bar = document.querySelector('[data-testid="start-bar"]');
      if (!el || !bar || el === document.body || bar.contains(el)) return null;
      const a = el.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const label =
        el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName;
      return overlap > 1
        ? `${el.tagName} "${label}" under the bar by ${Math.round(overlap)}px`
        : null;
    });
    if (hit) bad.push(hit);
  }
  return bad;
}

for (const vp of [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'laptop', width: 1280, height: 800, mobile: false },
  { name: 'phone landscape', width: 844, height: 390, mobile: true },
]) {
  test.describe(`focus and the Start bar, ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.mobile,
      isMobile: vp.mobile,
    });

    for (const [name, route] of [
      ['Freestyle', '#/setup/demo-mixed'],
      ['Experience', '#/setup/class-neon-grid-45?exp=neon-grid-45'],
    ] as const) {
      test(`${name}: no focused control ends up under the bar`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.goto(`./${route}`);
        await expect(page.getByTestId('advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
        expect(await obscuredByBar(page)).toEqual([]);
      });
    }
  });
}

test.describe('on-screen keyboard (short viewport)', () => {
  test.use({ viewport: { width: 390, height: 400 }, hasTouch: true, isMobile: true });

  test('the bar steps aside while a name is typed, and comes back', async ({ page }) => {
    await closedAccordion(page);
    await page.goto('./#/setup/demo-mixed');
    const bar = page.getByTestId('start-bar');
    await expect(bar).toBeVisible();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const name = page.getByLabel('Name');
    await expect(name).toBeFocused();
    await expect(bar).toBeHidden();
    await name.fill('Kasia');
    await expect(name).toBeInViewport();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(bar).toBeVisible();
  });
});

test.describe('Polish labels', () => {
  test.use({ locale: 'pl-PL', viewport: { width: 390, height: 844 } });

  test('the bar chips are never cut off', async ({ page }) => {
    await closedAccordion(page);
    await page.goto('./#/setup/demo-mixed');
    const bar = page.getByTestId('start-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('bar-music')).toContainText('Muzyka');
    for (const width of [390, 360, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const cut = await bar
        .locator('button > span')
        .evaluateAll((spans) =>
          spans.filter((s) => s.scrollWidth > s.clientWidth).map((s) => s.textContent),
        );
      expect(cut, `${width}px`).toEqual([]);
    }
  });
});

test.describe('"Fix it" leads to the field', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a missing YouTube link: focus lands in the link field, clear of the bar', async ({
    page,
  }, info) => {
    // Reduced motion scrolls at once, so the position can be measured right after the click.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await closedAccordion(page);
    await seedSettings(page, info, null, {
      lastSession: { background: 'youtube', hud: 'immersive', playerIds: [], music: false },
    });
    await page.goto('./#/setup/demo-mixed');
    const bar = page.getByTestId('start-bar');
    await bar.getByRole('button', { name: 'Fix it' }).click();
    const link = page.getByLabel('YouTube link');
    await expect(link).toBeFocused();
    await expect(link).toBeInViewport();
    const [field, barBox] = [await link.boundingBox(), await bar.boundingBox()];
    expect((field?.y ?? 0) + (field?.height ?? 0)).toBeLessThanOrEqual(barBox?.y ?? 0);
  });
});
