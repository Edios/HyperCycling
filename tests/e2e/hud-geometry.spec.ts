import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

// Experience ride on phones and wide landscape screens: no text sticks out of its panel or the
// screen, panels do not overlap each other, and the quick settings stay on screen.
// Pages build only (sessions autosave to the shared local database).

const VIEWPORTS = [
  { width: 915, height: 412 },
  { width: 2000, height: 900 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
];

async function startExperience(page: Page): Promise<void> {
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  // The keydown binding can land just after the screen shows; press again until it starts.
  await expect(async () => {
    if ((await page.getByTestId('training-screen').getAttribute('data-status')) === 'idle')
      await page.keyboard.press('Space');
    await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
      timeout: 1500,
    });
  }).toPass({ timeout: 20_000 });
}

interface Problem {
  what: string;
}

/** Text outside its [data-g] panel or the viewport; two panels of one layout overlapping. */
async function geometryProblems(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const TOL = 1.5;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out: { what: string }[] = [];
    const panels = [...document.querySelectorAll<HTMLElement>('[data-g]')].filter(
      (p) => p.getBoundingClientRect().width > 0,
    );
    for (const panel of panels) {
      const pr = panel.getBoundingClientRect();
      const g = panel.getAttribute('data-g');
      if (panel.closest('[data-hidden]')) continue;
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const text = (n.textContent ?? '').trim();
        if (!text) continue;
        const el = n.parentElement;
        if (!el || getComputedStyle(el).visibility === 'hidden') continue;
        if (
          el.closest('.sr-only, [aria-hidden="true"]') &&
          !el.closest('[data-testid="position-badge"]')
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Horizontal only: a line box is taller than its ink, so the vertical edge is noisy.
        const inPanel = r.left >= pr.left - TOL && r.right <= pr.right + TOL;
        const inView = r.left >= -TOL && r.right <= vw + TOL;
        if (!inPanel) out.push({ what: `text "${text}" sticks out of panel ${g}` });
        else if (!inView) out.push({ what: `text "${text}" outside the screen (panel ${g})` });
      }
      if (pr.left < -TOL || pr.right > vw + TOL || pr.top < -TOL || pr.bottom > vh + TOL)
        out.push({ what: `panel ${g} outside the screen` });
    }
    for (let i = 0; i < panels.length; i += 1) {
      for (let j = i + 1; j < panels.length; j += 1) {
        const a = panels[i]!.getBoundingClientRect();
        const b = panels[j]!.getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2)
          out.push({
            what: `panels ${panels[i]!.getAttribute('data-g')} and ${panels[j]!.getAttribute('data-g')} overlap`,
          });
      }
    }
    return out;
  });
}

for (const size of VIEWPORTS) {
  for (const locale of ['en-US', 'pl-PL']) {
    test.describe(locale, () => {
      test.use({ locale });
      test(`Experience HUD geometry at ${size.width}x${size.height}`, async ({ page }, info) => {
        test.skip(info.project.name !== 'pages', 'runs on the pages build only');
        test.setTimeout(120_000);
        await page.setViewportSize(size);
        await startExperience(page);
        const bad: string[] = [];
        // H cycles the five layouts (Corners, Column, Cockpit, Minimal, Focus).
        for (let i = 0; i < 5; i += 1) {
          await page.waitForTimeout(350);
          const id = await page
            .locator('[data-testid^="layout-"]')
            .first()
            .getAttribute('data-testid');
          for (const p of await geometryProblems(page)) bad.push(`${id}: ${p.what}`);
          await page.keyboard.press('KeyH');
        }
        expect(bad).toEqual([]);
      });
    });
  }

  test(`Experience quick settings stay on screen at ${size.width}x${size.height}`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await startExperience(page);
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Quick settings' }).click();
    const panel = page.getByTestId('quick-settings');
    await expect(panel).toBeVisible();
    // Only the layout and Lite: no background, world, riders, beeps or cues.
    await expect(panel.getByRole('radio')).toHaveCount(5);
    await expect(panel.getByRole('switch')).toHaveCount(1);
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    const clipped = await panel.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>('label, span, button')]
        .filter(
          (e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible',
        )
        .map((e) => e.textContent),
    );
    expect(clipped).toEqual([]);
  });
}

test('Experience preview offers only the HUD layout and Lite (no background or world choice)', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await expect(page.getByTestId('setup-experience')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Lite / no visuals' })).toBeVisible();
  await expect(
    page.getByRole('radiogroup', { name: 'Screen layout' }).getByRole('radio'),
  ).toHaveCount(5);
  await expect(page.getByRole('heading', { name: 'Background' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'World', exact: true })).toHaveCount(0);
  await expect(page.getByText('YouTube')).toHaveCount(0);
  // A regular workout keeps the full choice.
  await page.goto('./#/setup/demo-mixed');
  await expect(page.getByRole('heading', { name: 'Background' })).toBeVisible();
});

// Knob calibration (E15): the HUD shows the saved position for the current step; without a
// calibration nothing is added. Geometry must hold either way.
for (const size of [
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
]) {
  for (const calibrated of [true, false]) {
    test(`Knob calibration HUD ${calibrated ? 'with' : 'without'} calibration at ${size.width}x${size.height}`, async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'pages', 'runs on the pages build only');
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      await seedSettings(
        page,
        info,
        null,
        calibrated ? { resistanceMode: 'knob', knobSteps: [2, 4, 6, 8, 10] } : {},
      );
      await startExperience(page);
      const line = page.getByTestId('knob-line');
      if (calibrated) await expect(line.first()).toBeVisible();
      else await expect(line).toHaveCount(0);
      const bad: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        await page.waitForTimeout(350);
        const id = await page
          .locator('[data-testid^="layout-"]')
          .first()
          .getAttribute('data-testid');
        for (const p of await geometryProblems(page)) bad.push(`${id}: ${p.what}`);
        await page.keyboard.press('KeyH');
      }
      expect(bad).toEqual([]);
      await page.screenshot({
        path: `test-results/knob-hud-${calibrated ? 'cal' : 'nocal'}-${size.width}.png`,
      });
    });
  }
}
