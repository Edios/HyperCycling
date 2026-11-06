import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Sessions autosave to the shared local database, so the local projects would collide with each
// other; the pages build has its own IndexedDB per test and runs this on its own.

async function requireWebgl(page: Page): Promise<void> {
  await page.goto('about:blank');
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  });
  test.skip(!webgl, 'WebGL is not available in this headless browser');
}

async function startWorld(page: Page, withPlayer: boolean): Promise<void> {
  await page.goto('./#/setup/demo-mixed');
  await page.getByRole('button', { name: /^World/ }).click();
  await expect(page.getByRole('radio', { name: 'Corners' })).toBeChecked();
  if (withPlayer) {
    await page.getByRole('button', { name: '+ Add' }).click();
    const form = page.getByTestId('add-player-form');
    await form.getByLabel('Name').fill('Mirek');
    await form.getByLabel('FTP (W)').fill('250');
    await form.getByRole('button', { name: 'Add rider' }).click();
    const riders = page.getByRole('switch', { name: 'Show riders' });
    await expect(riders).toBeEnabled();
    if (!(await riders.isChecked())) await riders.click();
    await expect(riders).toBeChecked();
  }
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
}

test('World: canvas renders under the HUD, H cycles layouts, G toggles players', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await requireWebgl(page);
  await page.setViewportSize({ width: 1920, height: 1080 });

  await startWorld(page, true);
  const canvas = page.getByTestId('world-canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 15_000 })
    .toBeGreaterThan(300);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
    timeout: 8000,
  });
  const shot = async (name: string): Promise<void> => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
  };

  // With a rider: Corners and Column show players; Cockpit and Minimal have no room for them.
  await expect(page.getByTestId('layout-immersive')).toBeVisible();
  await expect(page.getByTestId('players-list')).toBeVisible();
  await shot('immersive-players');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-column')).toBeVisible();
  await expect(page.getByTestId('players-list')).toBeVisible();
  await shot('column-players');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-cockpit')).toBeVisible();
  await expect(page.getByTestId('players-list')).toHaveCount(0);
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-tunnel')).toBeVisible();
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('focus-layer')).toBeVisible();
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-immersive')).toBeVisible();
  await expect(page.getByTestId('focus-layer')).toHaveCount(0);

  // G hides the rider.
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('players-list')).toHaveCount(0);
  await shot('immersive');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-column')).toBeVisible();
  await shot('column');
  // Column: the effort numeral is at least 96 px at 1920x1080 and the panel packs upward.
  const numPx = await page
    .getByTestId('effort-value-number')
    .evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  expect(numPx).toBeGreaterThanOrEqual(96);
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-cockpit')).toBeVisible();
  await shot('cockpit');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-tunnel')).toBeVisible();
  await shot('tunnel-time');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('focus-layer')).toBeVisible();
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('layout-immersive')).toBeVisible();

  // A hard block: the floor (group P) is the timeline with the current block marked.
  for (let i = 0; i < 12; i += 1) {
    const effort = Number(
      (await page.getByTestId('effort-value-number').textContent())?.trim() ?? '0',
    );
    if (effort >= 8) break;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
  }
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-g', 'P');
  await expect(page.getByTestId('timeline').locator('[data-state="current"]')).toHaveCount(1);
  await shot('immersive-high-effort');

  // Phone portrait, Column without riders: the timeline sits at the bottom, not mid-screen.
  await page.setViewportSize({ width: 390, height: 844 });
  while ((await page.getByTestId('layout-column').count()) === 0) {
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);
  const floor = (await page.getByTestId('timeline').boundingBox())!;
  expect(floor.y + floor.height).toBeGreaterThan(844 - 24);
  const phoneNum = await page
    .getByTestId('effort-value-number')
    .evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  expect(phoneNum).toBeGreaterThanOrEqual(63.9);
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('players-list')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Phone: riders panel lists every rider with FTP and target, unclipped between Time and Cadence', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(120_000);
  await requireWebgl(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/setup/demo-mixed');
  await page.getByRole('button', { name: /^World/ }).click();
  for (const [name, ftp] of [
    ['Mirek', '250'],
    ['Ania', '190'],
    ['Bartek', '300'],
  ] as const) {
    await page.getByRole('button', { name: '+ Add' }).click();
    const form = page.getByTestId('add-player-form');
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('FTP (W)').fill(ftp);
    await form.getByRole('button', { name: 'Add rider' }).click();
  }
  const toggle = page.getByRole('switch', { name: 'Show riders' });
  await expect(toggle).toBeEnabled();
  if (!(await toggle.isChecked())) await toggle.click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();

  const list = page.getByTestId('players-list');
  await expect(list).toBeVisible();
  for (const name of ['Mirek', 'Ania', 'Bartek']) await expect(list).toContainText(name);
  await expect(list).toContainText('FTP 250 W');
  await expect(list).toContainText('FTP 190 W');
  await expect(list).toContainText('FTP 300 W');
  await expect(list).toContainText(/\d+ W/);

  const box = (await list.boundingBox())!;
  expect(box.height).toBeGreaterThan(80);
  const fits = await list.evaluate((el) => {
    const ul = el.querySelector('ul')!;
    return {
      panel: el.scrollHeight <= el.clientHeight + 1,
      listOk: ul.scrollHeight <= ul.clientHeight + 1 || getComputedStyle(ul).overflowY === 'auto',
    };
  });
  expect(fits.panel).toBe(true);
  expect(fits.listOk).toBe(true);
  for (const name of ['Mirek', 'Ania', 'Bartek']) {
    const r = (await list.getByText(name, { exact: true }).boundingBox())!;
    expect(r.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(r.y + r.height).toBeLessThanOrEqual(box.y + box.height + 1);
  }
  for (const g of ['C', 'M']) {
    const other = page.locator(`[data-testid^="layout-"] > [data-g="${g}"]`).first();
    if ((await other.count()) === 0) continue;
    const o = (await other.boundingBox())!;
    const overlap = !(o.y + o.height <= box.y + 0.5 || o.y >= box.y + box.height - 0.5);
    expect(overlap, `riders overlap panel ${g}`).toBe(false);
  }
});

const GEOMETRY_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 915, height: 412 },
  { width: 844, height: 390 },
  { width: 740, height: 360 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
];

const LAYOUT_TESTIDS = ['layout-immersive', 'layout-column', 'layout-cockpit', 'layout-tunnel'];

interface PanelBox {
  g: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every visible group panel (W/C/M/R/P) with its box, plus the riders' text fit. */
async function readPanels(page: Page): Promise<{
  panels: PanelBox[];
  riders: { name: string; ftp: boolean; ok: boolean }[];
}> {
  return page.evaluate(() => {
    const panels: PanelBox[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-g]'))) {
      const g = el.dataset.g ?? '';
      if (!['W', 'C', 'M', 'R', 'P'].includes(g)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05)
        continue;
      panels.push({ g, x: r.x, y: r.y, w: r.width, h: r.height });
    }
    const riders: { name: string; ftp: boolean; ok: boolean }[] = [];
    const list = document.querySelector<HTMLElement>('[data-testid="players-list"]');
    const ul = list?.querySelector('ul');
    if (list && ul) {
      const scrolls =
        getComputedStyle(ul).overflowY === 'auto' || ul.scrollHeight <= ul.clientHeight;
      const lr = list.getBoundingClientRect();
      for (const li of Array.from(ul.querySelectorAll('li'))) {
        const name = li.querySelector('span span')?.textContent ?? '';
        const ftp = li.querySelector('[data-testid="player-ftp"]');
        const rr = li.getBoundingClientRect();
        const inside = rr.bottom <= lr.bottom + 1 && rr.top >= lr.top - 1;
        // A row outside the panel is fine only when the list scrolls (it can be reached).
        riders.push({ name, ftp: ftp !== null, ok: inside || scrolls });
      }
    }
    return { panels, riders };
  });
}

test('HUD geometry: no panel intersects another at phone sizes, riders on and off', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(240_000);
  await requireWebgl(page);
  await page.setViewportSize(GEOMETRY_VIEWPORTS[1]!);
  await page.goto('./#/setup/demo-mixed');
  await page.getByRole('button', { name: /^World/ }).click();
  for (const [name, ftp] of [
    ['Mirek', '250'],
    ['Ania', '190'],
    ['Bartek', '300'],
  ] as const) {
    await page.getByRole('button', { name: '+ Add' }).click();
    const form = page.getByTestId('add-player-form');
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('FTP (W)').fill(ftp);
    await form.getByRole('button', { name: 'Add rider' }).click();
  }
  const toggle = page.getByRole('switch', { name: 'Show riders' });
  await expect(toggle).toBeEnabled();
  if (!(await toggle.isChecked())) await toggle.click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();

  const problems: string[] = [];
  for (const vp of GEOMETRY_VIEWPORTS) {
    await page.setViewportSize(vp);
    for (const ridersOn of [true, false]) {
      const hasList = (await page.getByTestId('players-list').count()) > 0;
      if (hasList !== ridersOn && (ridersOn || hasList)) await page.keyboard.press('KeyG');
      // Walk the five layouts (Focus last) once per state.
      for (let step = 0; step < 5; step += 1) {
        await page.waitForTimeout(250);
        const focus = (await page.getByTestId('focus-layer').count()) > 0;
        let layout = focus ? 'focus' : '';
        for (const id of LAYOUT_TESTIDS) {
          if ((await page.getByTestId(id).count()) > 0) layout = id.replace('layout-', '');
        }
        const tag = `${vp.width}x${vp.height} ${layout} riders=${ridersOn}`;
        const { panels, riders } = await readPanels(page);
        for (let i = 0; i < panels.length; i += 1) {
          const a = panels[i]!;
          if (a.x < -1 || a.y < -1 || a.x + a.w > vp.width + 1 || a.y + a.h > vp.height + 1) {
            problems.push(
              `${tag}: ${a.g} outside the screen ${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.w)}x${Math.round(a.h)}`,
            );
          }
          for (let j = i + 1; j < panels.length; j += 1) {
            const b = panels[j]!;
            const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (ox > 1 && oy > 1)
              problems.push(
                `${tag}: ${a.g} overlaps ${b.g} (${Math.round(a.y)}+${Math.round(a.h)} vs ${Math.round(b.y)}+${Math.round(b.h)})`,
              );
          }
        }
        if (ridersOn && (layout === 'immersive' || layout === 'column')) {
          const names = riders.map((r) => r.name);
          if (names.join() !== 'Mirek,Ania,Bartek') problems.push(`${tag}: riders ${names.join()}`);
          for (const r of riders) {
            if (!r.ftp) problems.push(`${tag}: ${r.name} has no FTP`);
            if (!r.ok) problems.push(`${tag}: ${r.name} clipped`);
          }
        }
        await page.keyboard.press('KeyH');
      }
    }
  }
  expect(problems).toEqual([]);
});
