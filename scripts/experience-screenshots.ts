/**
 * Regenerates docs/images/experience-*.png: the Neon Grid chapters and the Experience catalogue
 * at a phone (390x844) and a desktop (1280x720) size, from the static (IndexedDB) build.
 *
 *   npx tsx scripts/experience-screenshots.ts
 *
 * The World is driven by the dev page (`#/dev/world?world=scenes&exp=...&t=<second>`), so each
 * chapter is shown at a fixed workout second with the reduced-motion clock frozen.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { build, preview } from 'vite';

const OUT_DIR = path.resolve('docs/images');
const BUILD_DIR = path.resolve('dist/experience-shots');
const PORT = 5178;
const ORIGIN = `http://127.0.0.1:${PORT}/`;
const EXPERIENCE = 'neon-grid-45';

/** Chapter → a workout second inside it (see the scenario: song starts 0, 9, 16, 24:30, 32, 37, 41). */
const CHAPTERS: readonly { name: string; sec: number }[] = [
  { name: 'grid-wake', sec: 150 },
  { name: 'arches', sec: 1100 },
  { name: 'summit-scan', sec: 2000 },
  { name: 'overdrive', sec: 2290 },
  { name: 'afterglow', sec: 2600 },
];

const SIZES = [
  { tag: '390', width: 390, height: 844 },
  { tag: '1280', width: 1280, height: 720 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`docs/images/${name}.png`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  process.env.VITE_STORAGE = 'indexeddb';
  process.env.VITE_BASE = '/';
  await build({ logLevel: 'warn', build: { outDir: BUILD_DIR, emptyOutDir: true } });
  const server = await preview({
    base: '/',
    build: { outDir: BUILD_DIR },
    preview: { host: '127.0.0.1', port: PORT, strictPort: true },
  });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    for (const size of SIZES) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1,
        locale: 'en-US',
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      for (const c of CHAPTERS) {
        await page.goto(
          `${ORIGIN}?dev#/dev/world?world=scenes&exp=${EXPERIENCE}&t=${c.sec}&rate=0.0001`,
        );
        await page.getByTestId('world-canvas').waitFor();
        await shot(page, `experience-${c.name}-${size.tag}`);
      }
      await page.goto(`${ORIGIN}#/experiences`);
      await page.getByTestId('experience-card').first().waitFor();
      await page.getByRole('button', { name: 'Show scenario' }).click();
      await shot(page, `experience-picker-${size.tag}`);
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

void main();
