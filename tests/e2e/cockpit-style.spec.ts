import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Overlay HUD style checks (pages build only: sessions autosave to the shared local database).

// Every test starts its own World scene (software WebGL in CI: ~20 s each) and shares nothing, so
// they run in parallel workers (and spread over the CI shards) instead of one after another.
test.describe.configure({ mode: 'parallel' });

async function startOverlay(page: Page): Promise<void> {
  await page.goto('./#/setup/demo-mixed');
  await page.getByRole('button', { name: /^World/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
    timeout: 8000,
  });
}

async function showLayout(page: Page, id: string): Promise<void> {
  for (let i = 0; i < 6 && (await page.getByTestId(id).count()) === 0; i += 1) {
    await page.keyboard.press('KeyH');
    // The layout switches on the next render: return as soon as it is the one asked for.
    await page
      .getByTestId(id)
      .waitFor({ state: 'attached', timeout: 150 })
      .catch(() => undefined);
  }
  await expect(page.getByTestId(id)).toBeVisible();
}

/**
 * Reads until two reads 150 ms apart agree and returns the last one. If it never settles (an
 * animation that keeps running) it gives up after 6 s and returns what it has, as the sleep loops
 * it replaces did. The budget is generous on purpose: under load a single read can take a while.
 */
async function settled<T>(read: () => Promise<T>): Promise<T> {
  let previous: string | undefined;
  let last: T | undefined;
  await expect
    .poll(
      async () => {
        last = await read();
        const now = JSON.stringify(last);
        const same = now === previous;
        previous = now;
        return same;
      },
      { intervals: [150], timeout: 6000 },
    )
    .toBe(true)
    .catch(() => undefined);
  return last ?? (await read());
}

/** Ink box of the effort numeral and the vertical extent of the 'Effort' word / caption. */
async function ringMetrics(page: Page) {
  return page.evaluate(() => {
    const num = document.querySelector('[data-testid="effort-value-number"]') as HTMLElement;
    const cs = getComputedStyle(num);
    const range = document.createRange();
    range.selectNodeContents(num);
    const r = range.getBoundingClientRect();
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText(num.textContent ?? '');
    const baseline = r.top + m.fontBoundingBoxAscent;
    const inkTop = baseline - m.actualBoundingBoxAscent;
    const inkBottom = baseline + m.actualBoundingBoxDescent;
    const word = document.querySelector('[data-testid="effort-ring-word"]');
    const cap = document.querySelector('[data-testid="effort-caption"]');
    const lab = (word ?? cap) as HTMLElement | null;
    const lr = lab?.getBoundingClientRect();
    const ring = (
      document.querySelector('[data-testid="effort-ring"]') as HTMLElement
    ).getBoundingClientRect();
    const name = document.querySelector('[data-testid="effort-ring-box"]')
      ?.nextElementSibling as HTMLElement;
    const nr = name.getBoundingClientRect();
    return {
      effort: num.textContent,
      ringW: ring.width,
      inside: !!word,
      capHeight: inkBottom - inkTop,
      numBottom: inkBottom,
      labelTop: lr ? lr.top : null,
      labelBottom: lr ? lr.bottom : null,
      nameTop: nr.top,
    };
  });
}

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 915, height: 412 },
]) {
  test(`cockpit: panels do not intersect at ${size.width}x${size.height}`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    test.setTimeout(90_000);
    await page.setViewportSize(size);
    await startOverlay(page);
    await showLayout(page, 'layout-cockpit');
    // The panels settle after the viewport change and the layout switch: measure once they do.
    const boxes = await settled(() =>
      page.evaluate(() => {
        const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
        document.querySelectorAll('[data-testid="layout-cockpit"] > [data-g]').forEach((el) => {
          const r = el.getBoundingClientRect();
          out.push({
            id: el.getAttribute('data-g') ?? '',
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
          });
        });
        return out;
      }),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.w).toBeLessThanOrEqual(size.width + 0.5);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap =
          a.x < b.x + b.w - 0.5 &&
          b.x < a.x + a.w - 0.5 &&
          a.y < b.y + b.h - 0.5 &&
          b.y < a.y + a.h - 0.5;
        expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
  });
}

test('cockpit: the wing text keeps the panel tilt (one surface)', async ({ page }, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await startOverlay(page);
  await showLayout(page, 'layout-cockpit');
  const t = await page.evaluate(() => {
    const w = document.querySelector(
      '[data-testid="layout-cockpit"] > [data-g="W"]',
    ) as HTMLElement;
    return {
      wing: getComputedStyle(w).transform,
      child: getComputedStyle(w.firstElementChild as HTMLElement).transform,
      material: document
        .querySelector('[data-testid="layout-cockpit"]')
        ?.getAttribute('data-material'),
    };
  });
  if (t.material === 'glass') {
    expect(t.wing).not.toBe('none');
    // No rotation of its own (matrix3d entries 0 and 8 are cos and sin of the angle).
    const n =
      t.child === 'none'
        ? [1, 0, 0, 0, 0, 0, 0, 0, 0]
        : t.child
            .replace(/^matrix3d\(|\)$/g, '')
            .split(',')
            .map(Number);
    expect(n[0]).toBeCloseTo(1, 3);
    expect(n[8]).toBeCloseTo(0, 3);
  } else {
    expect(t.wing).toBe('none');
  }
});

for (const ring of [230, 260, 300]) {
  for (const layout of [
    'layout-immersive',
    'layout-column',
    'layout-cockpit',
    'layout-tunnel',
    'focus-layer',
  ]) {
    test(`effort label clears the numeral: ring ${ring}px in ${layout}`, async ({ page }, info) => {
      test.skip(info.project.name !== 'pages', 'runs on the pages build only');
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await startOverlay(page);
      await showLayout(page, layout);
      await page.evaluate((px) => {
        document.querySelectorAll('[data-layout]').forEach((el) => {
          (el as HTMLElement).style.setProperty('--ring', `${px}px`);
        });
      }, ring);
      // Layout geometry only: the glass tilt would inflate the boxes it is measured with.
      await page.evaluate(() => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('[data-g], [data-g] > * { transform: none !important; }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      });
      await page.evaluate(() => document.fonts.ready);
      for (let step = 0; step < 3; step += 1) {
        const m = await settled(() => ringMetrics(page));
        if (m.inside) {
          expect(m.labelTop!, `effort ${m.effort}`).toBeGreaterThanOrEqual(
            m.numBottom + 0.25 * m.capHeight,
          );
          expect(m.labelBottom!).toBeLessThanOrEqual(m.nameTop + 0.5);
        } else if (m.labelTop !== null) {
          expect(m.labelTop).toBeGreaterThanOrEqual(m.numBottom);
        }
        await page.keyboard.press('ArrowRight');
        // The next block animates in; there is no DOM signal for "done", so this stays a sleep.
        await page.waitForTimeout(1000);
      }
    });
  }
}
