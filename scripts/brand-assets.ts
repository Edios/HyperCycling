/**
 * Generates the brand assets in public/ from the same geometry the app draws (the 270 degree arc
 * of 10 rectangular zone ticks, no digit): logo.svg, favicon.svg/.ico/.png, the Apple touch icon,
 * the PWA icons (192/512 plus a maskable 512) and the 1200x630 social image.
 *
 * Usage: npx tsx scripts/brand-assets.ts
 * Renders with the Chromium that Playwright already installs; no extra dependency.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { ringSegments } from '../src/client/brand/geometry';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const BG = '#0b0e13';

/** The mark as SVG paths inside a 100x100 box. */
function markPaths(small: boolean): string {
  return ringSegments({ effort: 10, stroke: small ? 12 : 11, gap: small ? 5 : 4 })
    .map(
      (s) =>
        `<path d="${s.d}" fill="${s.color}" stroke="${s.color}" stroke-width="${s.strokeWidth}" stroke-linejoin="round"/>`,
    )
    .join('');
}

/** Mark scaled to `scale` of a square canvas, centred; optional background. */
function markSvg(
  px: number,
  opts: { bg?: string; scale?: number; small?: boolean; lower?: boolean } = {},
): string {
  const scale = opts.scale ?? 1;
  const off = (100 - 100 * scale) / 2;
  // The arc is open at the bottom, so its visual centre sits above the box centre: nudge it down.
  const dy = opts.lower ? 7 * scale : 0;
  const bg = opts.bg ? `<rect width="100" height="100" fill="${opts.bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 100 100">${bg}<g transform="translate(${off} ${off + dy}) scale(${scale})">${markPaths(opts.small ?? px < 40)}</g></svg>`;
}

function ico(images: { size: number; png: Buffer }[]): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dirs = images.map(({ size, png }) => {
    const d = Buffer.alloc(16);
    d.writeUInt8(size >= 256 ? 0 : size, 0);
    d.writeUInt8(size >= 256 ? 0 : size, 1);
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += png.length;
    return d;
  });
  return Buffer.concat([head, ...dirs, ...images.map((i) => i.png)]);
}

const fontUrl = (f: string): string => pathToFileURL(path.join(pub, 'fonts', f)).href;

function ogHtml(): string {
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:BC;font-weight:600;src:url(${fontUrl('BarlowCondensed-SemiBold.woff2')})}
@font-face{font-family:BC;font-weight:800;src:url(${fontUrl('BarlowCondensed-ExtraBold.woff2')})}
@font-face{font-family:B;font-weight:500;src:url(${fontUrl('Barlow-Medium.woff2')})}
html,body{margin:0;width:1200px;height:630px;background:${BG};overflow:hidden}
.wrap{display:flex;align-items:center;justify-content:center;gap:48px;height:630px}
.name{font-family:BC;font-style:italic;text-transform:uppercase;font-size:138px;line-height:.95;letter-spacing:3px;color:#f1f4f8}
.name b{display:block;font-weight:600;color:#9fb0c2}
.name i{display:block;font-weight:800;font-style:italic}
.tag{font-family:B;font-weight:500;font-size:26px;color:#8d97ab;margin-top:24px;letter-spacing:0}
</style><div class="wrap">${markSvg(300, { small: false })}<div><div class="name"><b>Hyper</b><i>Cycling</i></div><div class="tag">Structured indoor cycling with an effort scale you can feel</div></div></div>`;
}

async function main(): Promise<void> {
  mkdirSync(pub, { recursive: true });
  const write = (name: string, data: string | Buffer): void =>
    writeFileSync(path.join(pub, name), data);

  write('logo.svg', markSvg(512, { small: false }));
  write('favicon.svg', markSvg(64, { small: true }));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const shot = async (svg: string, px: number, transparent: boolean): Promise<Buffer> => {
      await page.setViewportSize({ width: px, height: px });
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
      );
      return page.screenshot({ omitBackground: transparent, type: 'png' });
    };

    const fav: { size: number; png: Buffer }[] = [];
    for (const size of [16, 32, 48]) {
      const png = await shot(markSvg(size, { scale: 1 }), size, true);
      write(`favicon-${size}.png`, png);
      fav.push({ size, png });
    }
    write('favicon.ico', ico(fav));
    write(
      'apple-touch-icon.png',
      await shot(markSvg(180, { bg: BG, scale: 0.72, lower: true }), 180, false),
    );
    write(
      'icon-192.png',
      await shot(markSvg(192, { bg: BG, scale: 0.78, lower: true }), 192, false),
    );
    write(
      'icon-512.png',
      await shot(markSvg(512, { bg: BG, scale: 0.78, lower: true }), 512, false),
    );
    // Maskable: the mark stays inside the central safe zone (80% circle) of a full-bleed square.
    write(
      'icon-maskable-512.png',
      await shot(markSvg(512, { bg: BG, scale: 0.56, lower: true }), 512, false),
    );

    await page.setViewportSize({ width: 1200, height: 630 });
    const tmp = path.join(tmpdir(), 'hypercycling-og.html');
    writeFileSync(tmp, ogHtml());
    await page.goto(pathToFileURL(tmp).href);
    await page.evaluate(() => document.fonts.ready);
    write('og-image.png', await page.screenshot({ type: 'png' }));
  } finally {
    await browser.close();
  }
  console.log('Brand assets written to public/');
}

void main();
