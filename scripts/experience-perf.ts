/**
 * Measures the Scenes engine on the Neon Grid 45 chapters (CPU per frame, draw calls) in headless
 * Chromium with a software GL (so GPU time is NOT measured here: read it from the Diagnostics
 * overlay on a real device).
 *
 *   npx tsx scripts/experience-perf.ts            # Standard and Lite, every chapter
 *
 * CPU = time inside requestAnimationFrame callbacks minus time inside GL calls (that is the JS
 * update() plus three.js bookkeeping). Draw calls are counted per frame at the GL level.
 */
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const BUILD_DIR = path.resolve('dist/experience-perf');
const PORT = 5179;
const ORIGIN = `http://127.0.0.1:${PORT}/`;
const CHAPTERS = [
  ['grid-wake', 150],
  ['light-lanes', 800],
  ['arches', 1100],
  ['surge', 1700],
  ['summit-scan', 2000],
  ['overdrive', 2290],
  ['afterglow', 2600],
] as const;

const PATCH = `
(() => {
  const w = window;
  w.__perf = { cpu: [], draws: [], gl: 0, cur: 0 };
  const proto = WebGL2RenderingContext.prototype;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const orig = proto[name];
    proto[name] = function (...a) {
      const t = performance.now();
      const r = orig.apply(this, a);
      w.__perf.gl += performance.now() - t;
      w.__perf.cur++;
      return r;
    };
  }
  const clear = proto.clear;
  proto.clear = function (...a) {
    if (w.__perf.cur > 0) w.__perf.draws.push(w.__perf.cur);
    w.__perf.cur = 0;
    return clear.apply(this, a);
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => {
    const g0 = w.__perf.gl;
    const t0 = performance.now();
    cb(ts);
    w.__perf.cpu.push(performance.now() - t0 - (w.__perf.gl - g0));
  });
})();
`;

const pct = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};

async function main(): Promise<void> {
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
    console.log('quality chapter       frames cpu_avg_ms cpu_p95_ms draws_avg');
    for (const quality of ['high', 'low']) {
      for (const [name, sec] of CHAPTERS) {
        const context = await browser.newContext({
          viewport: { width: 960, height: 540 },
          colorScheme: 'dark',
        });
        await context.addInitScript(PATCH);
        const page = await context.newPage();
        await page.goto(
          `${ORIGIN}?dev#/dev/world?world=scenes&exp=neon-grid-45&t=${sec}&quality=${quality}`,
        );
        await page.getByTestId('world-canvas').waitFor();
        await page.waitForTimeout(2500);
        await page.evaluate(() => {
          const p = (window as unknown as { __perf: { cpu: number[]; draws: number[] } }).__perf;
          p.cpu.length = 0;
          p.draws.length = 0;
        });
        await page.waitForTimeout(5000);
        const r = await page.evaluate(() => {
          const p = (window as unknown as { __perf: { cpu: number[]; draws: number[] } }).__perf;
          return { cpu: p.cpu.slice(), draws: p.draws.slice() };
        });
        const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
        console.log(
          `${quality.padEnd(7)}${name.padEnd(13)} ${String(r.cpu.length).padStart(6)} ${avg(r.cpu)
            .toFixed(2)
            .padStart(10)} ${pct(r.cpu, 0.95).toFixed(2).padStart(10)} ${avg(r.draws).toFixed(1).padStart(9)}`,
        );
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

void main();
