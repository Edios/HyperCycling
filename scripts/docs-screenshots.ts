/**
 * Regenerates docs/images/*.png (1280x720) from the static (IndexedDB) build.
 *
 *   npm run docs:screenshots
 *
 * Builds the Pages variant, serves it, seeds demo riders through the UI and drives the app with a
 * fixed page clock, so the numbers on screen are the same on every run.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { build, preview } from 'vite';

const OUT_DIR = path.resolve('docs/images');
const BUILD_DIR = path.resolve('dist/docs-shots');
const BASE = '/HyperCycling/';
const PORT = 5177;
const ORIGIN = `http://127.0.0.1:${PORT}${BASE}`;
const FIXED_TIME = new Date('2026-03-02T18:00:00');
const WORKOUT = 'sweet-spot-2x10';
const DEMO_RIDERS = [
  { name: 'Mirek', ftp: '270', me: true },
  { name: 'Ania', ftp: '190', me: false },
  { name: 'Tomek', ftp: '240', me: false },
];

/** mulberry32: deterministic Math.random replacement, injected before any page script runs. */
const SEEDED_RANDOM = `(() => {
  let a = 0x2f6e2b1;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;

async function shot(page: Page, name: string): Promise<void> {
  // Let layout, fonts and CSS transitions settle without moving the page clock.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`docs/images/${name}.png`);
}

async function seedRiders(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}#/players`);
  for (const r of DEMO_RIDERS) {
    const form = page.getByTestId('add-player-form');
    await form.getByLabel('Name').fill(r.name);
    await form.getByLabel('FTP (W)').fill(r.ftp);
    await form.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByTestId('player-row').filter({ hasText: r.name }).waitFor();
  }
  await page.getByRole('button', { name: 'This is me: Mirek' }).click();
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  // The static build keeps data in IndexedDB; the demo-only fixtures stay out (no VITE_E2E).
  process.env.VITE_STORAGE = 'indexeddb';
  process.env.VITE_BASE = BASE;
  await build({ logLevel: 'warn', build: { outDir: BUILD_DIR, emptyOutDir: true } });
  const server = await preview({
    base: BASE,
    build: { outDir: BUILD_DIR },
    preview: { host: '127.0.0.1', port: PORT, strictPort: true },
  });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.clock.install({ time: FIXED_TIME });
    // Hyperride draws its tunnel with Math.random; a seeded PRNG keeps the PNGs stable.
    await page.addInitScript(SEEDED_RANDOM);
    page.on('pageerror', (err) => console.warn('page error:', err.message));

    await seedRiders(page);
    await shot(page, 'players');

    await page.goto(`${ORIGIN}#/`);
    await page.getByTestId('app-shell').waitFor();
    await shot(page, 'plan');

    await page.goto(`${ORIGIN}#/plans`);
    await page.getByTestId('app-shell').waitFor();
    await shot(page, 'plan-gallery');

    await page.goto(`${ORIGIN}#/freestyle`);
    await page.getByTestId('workout-card').first().waitFor();
    await shot(page, 'freestyle');

    await page.goto(`${ORIGIN}#/setup/${WORKOUT}`);
    await page.getByTestId('setup-screen').waitFor();
    await page.getByRole('button', { name: /^Mirek/ }).click();
    await page.getByRole('button', { name: /^Ania/ }).click();
    await shot(page, 'setup');

    // Basic background with the players column.
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByTestId('training-screen').waitFor();
    await page.keyboard.press('Space');
    await page.clock.runFor(3_500);
    // One jump instead of ~6000 animation frames; the engine derives its state from the clock.
    await page.clock.fastForward(95_000);
    await page.clock.runFor(300);
    await shot(page, 'training-basic');
    await page.keyboard.press('Escape');
    await shot(page, 'end-dialog');
    await page.getByRole('button', { name: 'End and see summary' }).click();
    await page.getByTestId('summary-screen').waitFor();
    await shot(page, 'summary');

    // Hyperride with the Immersive overlay.
    await page.goto(`${ORIGIN}#/setup/${WORKOUT}`);
    await page.getByTestId('setup-screen').waitFor();
    await page.getByRole('button', { name: 'Hyperride', exact: true }).click();
    await page.getByRole('radio', { name: 'Immersive' }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByTestId('training-screen').waitFor();
    await page.keyboard.press('Space');
    await page.clock.runFor(3_500);
    // One jump instead of ~6000 animation frames; the engine derives its state from the clock.
    await page.clock.fastForward(95_000);
    await page.clock.runFor(300);
    await shot(page, 'training-hyperride');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Leave without saving' }).click();

    // Built-in workouts are read-only; the editor screen shows a user copy.
    await page.goto(`${ORIGIN}#/editor/${WORKOUT}`);
    await page.getByRole('button', { name: 'Duplicate to edit' }).click();
    await page.getByTestId('editor-screen').and(page.locator('[data-readonly="false"]')).waitFor();
    await page.getByTestId('editor-total').waitFor();
    await page
      .locator('[data-testid^="timeline"], [aria-label="Workout timeline"]')
      .first()
      .click({
        position: { x: 300, y: 40 },
        force: true,
      });
    await shot(page, 'editor');

    await page.goto(`${ORIGIN}#/settings`);
    await page.getByTestId('settings-general').waitFor();
    await shot(page, 'settings');
    const guide = page.getByTestId('ftp-guide');
    await guide.getByRole('button', { name: 'FTP test guide' }).click();
    await guide.getByRole('radio', { name: '20-minute test' }).click();
    await guide.getByLabel('20-minute average power (W)').fill('285');
    await guide.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, 'settings-ftp');

    await context.close();
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
