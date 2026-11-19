import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// The big coach cue of an Experience ride must never overlap the control buttons or the timeline
// (owner report: on a phone in portrait the text ran over both). Pages build only.

const PORTRAIT = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const LANDSCAPE = [{ width: 915, height: 412 }];
// Wider screens keep the full, unclipped text (a regression here cut the cue off at 1024x768 and
// on a portrait tablet, which is wider than the phone breakpoint).
const WIDE = [
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
];
// The longest real cues (pl.ts / en.ts), forced into the overlay so every run measures the worst case.
const LONGEST = [
  'Za 10 s: zmniejsz opór → wysiłek 7',
  'In 10 s: reduce resistance → effort 7',
  'Dodaj jeden stopień, RPM 90.',
];

async function startExperience(page: Page): Promise<void> {
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await expect(async () => {
    if ((await page.getByTestId('training-screen').getAttribute('data-status')) === 'idle')
      await page.keyboard.press('Space');
    await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
      timeout: 1500,
    });
  }).toPass({ timeout: 20_000 });
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Box of the cue text itself (its glyph lines), plus the boxes of everything it must not cover. */
async function measure(page: Page, force?: string) {
  return page.evaluate((forced) => {
    const cue = document.querySelector<HTMLElement>('[data-testid="coach-overlay"]');
    if (!cue) return null;
    if (forced) cue.textContent = forced;
    // Measure the resting layout: the entrance scales and the exit slides the text on purpose.
    cue.getAnimations().forEach((a) => a.cancel());
    const range = document.createRange();
    range.selectNodeContents(cue);
    const r = range.getBoundingClientRect();
    const box = (e: Element): Box => {
      const b = e.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    };
    const lineHeight = parseFloat(getComputedStyle(cue).lineHeight);
    const lines = Math.round(cue.scrollHeight / lineHeight);
    const blockers = [
      ...document.querySelectorAll('[data-testid="training-screen"] button'),
      ...document.querySelectorAll('[data-testid="timeline"]'),
      ...document.querySelectorAll('[data-g]'),
    ]
      .filter((e) => !e.contains(cue) && e.getBoundingClientRect().width > 0)
      .map((e) => ({
        name: e.getAttribute('data-g') ?? e.getAttribute('data-testid') ?? e.tagName,
        ...box(e),
      }));
    return {
      text: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      lines,
      vw: window.innerWidth,
      blockers,
    };
  }, force);
}

/** Skips blocks until a cue shows (they fire at block starts), then measures it. */
async function nextCue(page: Page, force?: string) {
  let m: Awaited<ReturnType<typeof measure>> = null;
  await expect(async () => {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    m = await measure(page, force);
    expect(m).not.toBeNull();
  }).toPass({ timeout: 40_000, intervals: [100] });
  return m!;
}

for (const size of [...PORTRAIT, ...LANDSCAPE, ...WIDE]) {
  test(`Experience coach cue does not overlap controls at ${size.width}x${size.height}`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await startExperience(page);
    // The natural cue, then each of the longest texts.
    for (const force of [undefined, ...LONGEST]) {
      const m = await nextCue(page, force);
      await page.screenshot({ path: `test-results/coach-${size.width}x${size.height}.png` });
      const label = force ?? 'natural cue';
      // Two lines is the phone rule; wide screens only need the whole text to show without overlap.
      if (size.width <= 760) expect(m.lines, `${label}: at most two lines`).toBeLessThanOrEqual(2);
      expect(m.text.left).toBeGreaterThanOrEqual(-1);
      expect(m.text.right).toBeLessThanOrEqual(m.vw + 1);
      const hits = m.blockers
        .filter(
          (b) =>
            Math.min(b.right, m.text.right) - Math.max(b.left, m.text.left) > 1 &&
            Math.min(b.bottom, m.text.bottom) - Math.max(b.top, m.text.top) > 1,
        )
        .map((b) => `${b.name} ${JSON.stringify(b)} vs text ${JSON.stringify(m.text)}`);
      expect(hits, `${label}: cue overlaps`).toEqual([]);
    }
  });
}
