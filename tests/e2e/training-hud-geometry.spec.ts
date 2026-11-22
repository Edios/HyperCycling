import path from 'node:path';
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures';

// Training screen geometry on phones and wide screens, with the now-playing chip on screen:
// the chip is visible in every layout (portrait too), the control buttons are 1:1 circles of a
// touch size, no text is cut by the screen or its panel, nothing overlaps, and the Column card
// has no dead area below its content. "Browser bar" sizes emulate a phone with the address bar
// showing: the visible viewport is ~110 px shorter than the full screen.
// Pages build only (sessions autosave to the shared local database). Spotify answers from route
// mocks, so nothing touches the real network.

const SHOTS = process.env.SHOTS_DIR ?? '';

const VIEWPORTS = [
  { width: 390, height: 844, name: 'phone-portrait' },
  { width: 360, height: 740, name: 'small-portrait' },
  { width: 844, height: 390, name: 'phone-landscape' },
  { width: 844, height: 280, name: 'phone-landscape-bar' },
  { width: 915, height: 412, name: 'wide-phone-landscape' },
  { width: 1280, height: 800, name: 'laptop' },
];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

const TRACKS = Array.from({ length: 12 }, (_, i) => ({
  id: `e2etrack${String(i).padStart(2, '0')}abcdefg`,
  name: `Night Ride ${i + 1}`,
  duration_ms: 215_000,
  artists: [{ name: 'Test Artist' }],
}));

async function mockSpotify(page: Page): Promise<void> {
  let playing: string | undefined;
  await page.route('https://accounts.spotify.com/authorize**', (route) => {
    const url = new URL(route.request().url());
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', 'e2e-code');
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    return route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  await page.route('https://accounts.spotify.com/api/token', (route) =>
    route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({
        access_token: 'e2e-access',
        refresh_token: 'e2e-refresh',
        expires_in: 3600,
      }),
    }),
  );
  await page.route('https://api.spotify.com/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    if (url.pathname === '/v1/search') return json({ tracks: { items: TRACKS } });
    if (url.pathname === '/v1/me/player/devices')
      return json({ devices: [{ id: 'D-PC', name: 'My PC', type: 'Computer', is_active: true }] });
    if (url.pathname === '/v1/me/player/play' && req.method() === 'PUT') {
      const uri = (req.postDataJSON() as { uris?: string[] } | null)?.uris?.[0];
      playing = uri?.split(':').pop();
    }
    if (url.pathname === '/v1/me/player' && req.method() === 'GET') {
      return json({
        device: { id: 'D-PC', volume_percent: 80 },
        ...(playing
          ? { is_playing: true, progress_ms: 5_000, item: { id: playing, duration_ms: 215_000 } }
          : {}),
      });
    }
    return route.fulfill({ status: 204, headers: CORS });
  });
}

async function connectSpotify(page: Page): Promise<void> {
  await page.goto('./#/settings');
  await page.getByLabel('Spotify Client ID').fill('e2eclientid');
  await page.getByTestId('spotify-connect').click();
  await expect(page.getByTestId('spotify-status')).toHaveAttribute('data-connected', 'true');
}

async function buildWorkoutWithTrack(page: Page, name: string): Promise<void> {
  await page.goto('./#/editor/new');
  await page.getByLabel('Workout name').fill(name);
  await page.getByTestId('editor-block').nth(0).click();
  await page.getByTestId('spotify-query').fill('night ride');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('spotify-result')).toHaveCount(10);
  await page.getByRole('button', { name: 'Use: Night Ride 3' }).click();
  await expect(page.getByTestId('music-pill')).toContainText('Night Ride 3');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/editor\/(?!new)/);
}

async function ride(
  page: Page,
  name: string,
  world: boolean,
  beforeStart?: (page: Page) => Promise<void>,
): Promise<void> {
  await page.goto('./#/freestyle');
  await page.getByRole('button', { name: 'Mine', exact: true }).click();
  await page.getByTestId('workout-card').filter({ hasText: name }).click();
  await page.getByTestId('workout-ride').click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  if (world) await page.getByRole('button', { name: /^World/ }).click();
  const music = page.getByRole('switch', { name: 'Music' });
  if (!(await music.isChecked())) await music.check();
  if (beforeStart) await beforeStart(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await expect(async () => {
    if ((await page.getByTestId('training-screen').getAttribute('data-status')) === 'idle')
      await page.keyboard.press('Space');
    await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
      timeout: 1500,
    });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId('now-playing')).toBeVisible({ timeout: 20_000 });
}

/** Everything wrong with the current layout, as readable lines. */
async function problems(page: Page): Promise<string[]> {
  // The control bar auto-hides; a pointer move brings it back for the measurements.
  await page.mouse.move(3, 3);
  await page.mouse.move(8, 8);
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const TOL = 1.5;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out: string[] = [];

    // 1. The now-playing chip is on screen.
    const chip = document.querySelector<HTMLElement>('[data-testid="now-playing"]');
    if (!chip) out.push('music chip missing');
    else {
      const r = chip.getBoundingClientRect();
      const cs = getComputedStyle(chip);
      if (cs.display === 'none' || r.width < 40 || r.height < 16)
        out.push(`music chip not shown (${Math.round(r.width)}x${Math.round(r.height)})`);
      else if (r.left < -TOL || r.top < -TOL || r.right > vw + TOL || r.bottom > vh + TOL)
        out.push(`music chip outside the screen ${JSON.stringify(r)}`);
    }

    // 2. Control buttons: 1:1 and a touch size.
    const hiddenBar = document.querySelector('[data-testid="controls"][data-hidden="true"]');
    if (hiddenBar) out.push('controls bar is hidden');
    for (const b of document.querySelectorAll<HTMLElement>('[data-testid="controls"] button')) {
      const r = b.getBoundingClientRect();
      const label = b.getAttribute('aria-label') ?? '?';
      // A phone in portrait drops two rare buttons on purpose (audit N-01: one calm row). Any
      // other hidden button, or these two anywhere else, is a defect; the rest must be touch size.
      if (b.getClientRects().length === 0) {
        const phonePortrait = vw <= 760 && vh > vw;
        if (!(phonePortrait && ['Previous block', 'Full screen'].includes(label)))
          out.push(
            `button "${label}" is hidden (only allowed for two buttons on a phone in portrait)`,
          );
        continue;
      }
      if (Math.abs(r.width - r.height) > 1)
        out.push(`button "${label}" is ${r.width.toFixed(1)}x${r.height.toFixed(1)}, not 1:1`);
      if (r.width < 43)
        out.push(`button "${label}" is only ${r.width.toFixed(1)}px wide (touch size is 44)`);
      const svg = b.querySelector('svg')?.getBoundingClientRect();
      if (svg && (Math.abs(svg.width - svg.height) > 0.5 || svg.width > r.width * 0.7))
        out.push(`icon of "${label}" is ${svg.width.toFixed(1)}x${svg.height.toFixed(1)}`);
      if (r.left < -TOL || r.right > vw + TOL || r.top < -TOL || r.bottom > vh + TOL)
        out.push(`button "${label}" outside the screen`);
    }
    // The settings button must not be the sun: the gear has a toothed outline (a long path).
    const gear = document.querySelector('[aria-label="Quick settings"] svg path');
    if (gear && (gear.getAttribute('d')?.length ?? 0) < 120)
      out.push('quick settings icon is the sun, not a gear');

    // 3. Panels: text inside panel and screen (both axes), no clipping, no overlap.
    const panels = [...document.querySelectorAll<HTMLElement>('[data-g]')].filter(
      (p) => p.getBoundingClientRect().width > 0 && !p.closest('[data-hidden]'),
    );
    for (const panel of panels) {
      const pr = panel.getBoundingClientRect();
      const g = panel.getAttribute('data-g');
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
        if (r.left < pr.left - TOL || r.right > pr.right + TOL)
          out.push(`text "${text}" sticks out of panel ${g} sideways`);
        else if (r.left < -TOL || r.right > vw + TOL)
          out.push(`text "${text}" outside the screen (panel ${g})`);
        // A line box is taller than its ink: allow 20% of the line on the vertical axis.
        const slack = r.height * 0.2;
        if (r.top < -slack || r.bottom > vh + slack)
          out.push(`text "${text}" cut off by the screen edge (panel ${g})`);
        if (r.top < pr.top - slack || r.bottom > pr.bottom + slack)
          out.push(`text "${text}" sticks out of panel ${g} vertically`);
      }
      if (pr.left < -TOL || pr.right > vw + TOL || pr.top < -TOL || pr.bottom > vh + TOL)
        out.push(`panel ${g} outside the screen`);
      if (
        getComputedStyle(panel).overflow !== 'visible' &&
        panel.scrollHeight > panel.clientHeight + 2
      )
        out.push(`panel ${g} clips its content`);
    }
    for (let i = 0; i < panels.length; i += 1) {
      for (let j = i + 1; j < panels.length; j += 1) {
        const a = panels[i]!.getBoundingClientRect();
        const b = panels[j]!.getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2)
          out.push(
            `panels ${panels[i]!.getAttribute('data-g')} and ${panels[j]!.getAttribute('data-g')} overlap`,
          );
      }
    }

    // 4. The controls do not sit on a panel either.
    const bar = document.querySelector('[data-testid="controls"]')?.getBoundingClientRect();
    if (bar)
      for (const p of panels) {
        const r = p.getBoundingClientRect();
        const ox = Math.min(bar.right, r.right) - Math.max(bar.left, r.left);
        const oy = Math.min(bar.bottom, r.bottom) - Math.max(bar.top, r.top);
        if (ox > 2 && oy > 2) out.push(`controls overlap panel ${p.getAttribute('data-g')}`);
      }

    // 5. The Column card is fitted to its content (no dead area at the bottom).
    const card = document.querySelector<HTMLElement>('[data-testid="column-panel"]');
    if (card && card.getBoundingClientRect().width > 0) {
      const cr = card.getBoundingClientRect();
      const bottoms = [...card.children].map((c) => c.getBoundingClientRect().bottom);
      const gap = cr.bottom - Math.max(...bottoms);
      if (gap > Math.max(24, vh * 0.05))
        out.push(`column card has ${Math.round(gap)}px of dead space at the bottom`);
    }

    // 6. Cadence shows a number or is not drawn: no bare placeholder. A live sensor that went
    //    quiet shows a dash on purpose (missing, never 0), together with the signal line.
    const rpm = document.querySelector('[data-testid="rpm-value-number"]');
    const quiet = rpm?.closest('[data-signal]:not([data-signal="live"])');
    if (rpm && !quiet && !/^\d+$/.test(rpm.textContent?.trim() ?? ''))
      out.push(`cadence shows "${rpm.textContent}" instead of a number`);

    // 7. The workout title is whole (it may wrap, it must not be cut with an ellipsis).
    const title = document.querySelector<HTMLElement>('[data-testid="timeline"] b');
    if (title && title.scrollWidth > title.clientWidth + 1)
      out.push(`workout title is truncated ("${title.textContent}")`);
    return out;
  });
}

const shot = async (page: Page, name: string): Promise<void> => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function setup(
  page: Page,
  world: boolean,
  beforeStart?: (page: Page) => Promise<void>,
): Promise<void> {
  await mockSpotify(page);
  await connectSpotify(page);
  const name = `E2E HUD ${Date.now()}`;
  await buildWorkoutWithTrack(page, name);
  await ride(page, name, world, beforeStart);
}

// ---- live sensors (fake trainer and strap from the e2e build hook) ----

declare global {
  interface Window {
    __sensorPump?: ReturnType<typeof setInterval>;
  }
}

/**
 * Fake navigator.bluetooth from the e2e build hook, switched on through localStorage before every
 * page load, so it survives the Spotify sign-in redirect (a full reload).
 */
async function installSensors(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'hypercycling.e2e.fakeBluetooth',
      JSON.stringify({
        trainer: { noiseW: 0, freeRidePowerW: 180, powerTimeConstantMs: 300 },
        hrBpm: 148,
      }),
    );
  });
}

async function sensorsOn(page: Page): Promise<void> {
  await page.evaluate(() => {
    clearInterval(window.__sensorPump);
    const fake = window.__hcBle!.fake!;
    window.__sensorPump = setInterval(() => fake.pump(Date.now()), 500);
  });
}

/** Setup screen: connect both sensors and add a rider with an FTP (power target, riders tile). */
async function connectSensorsAndRider(page: Page): Promise<void> {
  await sensorsOn(page);
  const setupScreen = page.getByTestId('setup-screen');
  await setupScreen.getByRole('button', { name: 'Connect trainer' }).click();
  await setupScreen.getByRole('button', { name: 'Connect strap' }).click();
  await expect(setupScreen.getByText('148 bpm')).toBeVisible();
  await setupScreen.getByRole('button', { name: 'Add', exact: true }).click();
  const form = page.getByTestId('add-player-form');
  await form.getByLabel('Name').fill('Mirek');
  await form.getByLabel('FTP (W)', { exact: true }).fill('250');
  await form.getByRole('button', { name: 'Add rider' }).click();
}

// "-bar" sizes: the browser's address bar is showing (~110 px less height).
const SENSOR_VIEWPORTS = [
  { width: 390, height: 844, name: 'phone-portrait' },
  { width: 390, height: 734, name: 'phone-portrait-bar' },
  { width: 844, height: 390, name: 'phone-landscape' },
  { width: 844, height: 280, name: 'phone-landscape-bar' },
  { width: 1280, height: 800, name: 'laptop' },
];

/** Problems with the live rows, then with the same rows after the sensors went quiet. */
async function sensorProblems(page: Page, label: string): Promise<string[]> {
  const bad: string[] = [];
  await expect(page.getByTestId('rpm-value')).toHaveAttribute('data-signal', 'live');
  for (const p of await problems(page)) bad.push(`${label} live: ${p}`);
  await page.evaluate(() => clearInterval(window.__sensorPump));
  await expect(page.getByTestId('live-signal')).toBeVisible({ timeout: 6000 });
  await shot(page, `${label.replace(' ', '-')}-nosignal`);
  for (const p of await problems(page)) bad.push(`${label} no signal: ${p}`);
  await sensorsOn(page);
  await expect(page.getByTestId('rpm-value')).toHaveAttribute('data-signal', 'live');
  return bad;
}

test('overlay layouts (World): music chip, round buttons, no clipping at phone and wide sizes', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(240_000);
  await page.goto('about:blank');
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  });
  test.skip(!webgl, 'WebGL is not available in this headless browser');
  await setup(page, true);

  const bad: string[] = [];
  for (const size of VIEWPORTS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    // H cycles the layouts (Corners, Column, Cockpit, Minimal, Focus).
    for (let i = 0; i < 5; i += 1) {
      await page.waitForTimeout(350);
      const id = await page.locator('[data-testid^="layout-"]').first().getAttribute('data-testid');
      await shot(page, `${size.name}-${id}`);
      for (const p of await problems(page)) bad.push(`${size.name} ${id}: ${p}`);
      await page.keyboard.press('KeyH');
    }
  }
  expect(bad).toEqual([]);
});

test('plain tiles (Basic): music chip, round buttons, no dead gap in portrait', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(180_000);
  await setup(page, false);

  const bad: string[] = [];
  for (const size of VIEWPORTS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(400);
    await shot(page, `${size.name}-tiles`);
    for (const p of await problems(page)) bad.push(`${size.name} tiles: ${p}`);
  }
  expect(bad).toEqual([]);
});

test('live sensors on plain tiles (Basic): power, cadence and HR rows fit, also without signal', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(240_000);
  await installSensors(page);
  await setup(page, false, connectSensorsAndRider);

  const bad: string[] = [];
  for (const size of SENSOR_VIEWPORTS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(400);
    await shot(page, `${size.name}-tiles-sensors`);
    bad.push(...(await sensorProblems(page, `${size.name} tiles`)));
  }
  expect(bad).toEqual([]);
});

test('live sensors on overlay layouts (World): rows fit in every layout, also without signal', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(360_000);
  await page.goto('about:blank');
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  });
  test.skip(!webgl, 'WebGL is not available in this headless browser');
  await installSensors(page);
  await setup(page, true, connectSensorsAndRider);

  const bad: string[] = [];
  for (const size of SENSOR_VIEWPORTS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    // H cycles the layouts (Corners, Column, Cockpit, Minimal, Focus).
    for (let i = 0; i < 5; i += 1) {
      await page.waitForTimeout(350);
      const id = await page.locator('[data-testid^="layout-"]').first().getAttribute('data-testid');
      await shot(page, `${size.name}-${id}-sensors`);
      // Focus fades the HUD out between inputs; its corner HUD is Immersive, checked first.
      if ((await page.getByTestId('focus-layer').count()) === 0)
        bad.push(...(await sensorProblems(page, `${size.name} ${id}`)));
      await page.keyboard.press('KeyH');
    }
  }
  expect(bad).toEqual([]);
});
