import path from 'node:path';
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures';

// Music UI end to end. Sessions autosave to the shared local database, so this runs on the pages
// build only (its own IndexedDB per test). Nothing touches the real network: Spotify, its login
// and YouTube's oEmbed answer from route mocks.

const SHOTS = process.env.SHOTS_DIR ?? '';
const shot = async (page: Page, name: string): Promise<void> => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `9.4-${name}.png`) });
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

interface SpotifyMock {
  calls: string[];
  /** Searches are answered with these (the app must still show at most 10). */
  devices: { id: string; name: string; type: string; is_active: boolean }[];
}

const TRACKS = Array.from({ length: 12 }, (_, i) => ({
  id: `e2etrack${String(i).padStart(2, '0')}abcdefg`,
  name: `Night Ride ${i + 1}`,
  duration_ms: 215_000,
  artists: [{ name: 'Test Artist' }],
}));

async function mockSpotify(page: Page, devices: SpotifyMock['devices']): Promise<SpotifyMock> {
  const mock: SpotifyMock = { calls: [], devices };

  // The consent page: approve at once by redirecting back with a code and the same state.
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
    mock.calls.push(`${req.method()} ${url.pathname}${url.search}`);
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    if (url.pathname === '/v1/search') return json({ tracks: { items: TRACKS } });
    if (url.pathname === '/v1/me/player/devices') return json({ devices: mock.devices });
    if (url.pathname === '/v1/me/player' && req.method() === 'GET') {
      return json({ device: { id: 'D-PC', volume_percent: 80 } });
    }
    return route.fulfill({ status: 204, headers: CORS });
  });
  return mock;
}

async function connectSpotify(page: Page): Promise<void> {
  await page.goto('./#/settings');
  await page.getByLabel('Spotify Client ID').fill('e2eclientid');
  await page.getByTestId('spotify-connect').click();
  // The mocked consent page sends the browser straight back to the settings screen.
  await expect(page.getByTestId('spotify-status')).toHaveAttribute('data-connected', 'true');
}

async function buildWorkoutWithSpotifyTrack(page: Page, name: string): Promise<void> {
  await page.goto('./#/editor/new');
  await page.getByLabel('Workout name').fill(name);
  // The warm-up, so the music starts with the ride.
  await page.getByTestId('editor-block').nth(0).click();
  await page.getByTestId('spotify-query').fill('night ride');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('spotify-result')).toHaveCount(10);
  await page.getByRole('button', { name: 'Use: Night Ride 3' }).click();
  await expect(page.getByTestId('music-pill')).toContainText('Night Ride 3');
  await shot(page, 'editor-lane');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/editor\/(?!new)/);
}

async function rideIt(page: Page, name: string): Promise<void> {
  await page.goto('./#/freestyle');
  await page.getByRole('button', { name: 'Mine', exact: true }).click();
  await page.getByTestId('workout-card').filter({ hasText: name }).click();
  await page.getByTestId('workout-ride').click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  const music = page.getByRole('switch', { name: 'Music' });
  if (!(await music.isChecked())) await music.check({ force: true });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
}

async function rideWithRider(page: Page, name: string, world: boolean): Promise<void> {
  await page.goto('./#/freestyle');
  await page.getByRole('button', { name: 'Mine', exact: true }).click();
  await page.getByTestId('workout-card').filter({ hasText: name }).click();
  await page.getByTestId('workout-ride').click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  if (world) await page.getByRole('button', { name: /^World/ }).click();
  await page.getByRole('button', { name: '+ Add' }).click();
  const form = page.getByTestId('add-player-form');
  await form.getByLabel('Name').fill('Mirek');
  await form.getByLabel('FTP (W)').fill('250');
  await form.getByRole('button', { name: 'Add rider' }).click();
  const music = page.getByRole('switch', { name: 'Music' });
  if (!(await music.isChecked())) await music.check({ force: true });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await page.keyboard.press('Space');
}

/** Text-bearing HUD pieces that sit under the now-playing corner (none is the goal). */
async function underCorner(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="now-playing"]')?.getBoundingClientRect();
    if (!c) return ['no corner'];
    const hits: string[] = [];
    const root = document.querySelector('[data-testid="training-screen"]');
    for (const el of root?.querySelectorAll<HTMLElement>('*') ?? []) {
      if (el.closest('[data-testid="now-playing"]') || el.closest('[data-testid="toast-stack"]'))
        continue;
      if (el.children.length > 0 || !el.textContent?.trim()) continue; // leaf text only
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const hit = r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top;
      if (hit) hits.push(`${el.tagName}.${el.className}:${el.textContent.trim().slice(0, 20)}`);
    }
    return hits;
  });
}

test('Spotify: connect, pick a device, search in the editor, play with a now-playing corner and mute', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const mock = await mockSpotify(page, [
    { id: 'D-PC', name: 'My PC', type: 'Computer', is_active: true },
    { id: 'D-KITCHEN', name: 'Kitchen speaker', type: 'Speaker', is_active: false },
  ]);

  await connectSpotify(page);
  const device = page.getByTestId('spotify-device');
  await expect(device.locator('option')).toHaveCount(3);
  await device.selectOption('D-KITCHEN');
  await expect(page.getByTestId('redirect-uri').first()).toHaveText(
    'http://127.0.0.1:5176/',
  );
  await shot(page, 'settings-music');

  const name = `E2E Music ${Date.now()}`;
  await buildWorkoutWithSpotifyTrack(page, name);
  await rideIt(page, name);
  await page.keyboard.press('Space');
  const corner = page.getByTestId('now-playing');
  await expect(corner).toBeVisible({ timeout: 15_000 });
  await expect(corner).toContainText('Night Ride 3');
  await expect(corner).toContainText('Test Artist');
  expect(mock.calls.some((c) => c.startsWith('PUT /v1/me/player/play?device_id=D-KITCHEN'))).toBe(
    true,
  );
  await shot(page, 'training-corner');

  await page.keyboard.press('m');
  await expect(corner).toHaveAttribute('data-muted', 'true');
  await expect
    .poll(() => mock.calls.some((c) => c.includes('/v1/me/player/volume?volume_percent=0')))
    .toBe(true);
  await page.keyboard.press('m');
  await expect(corner).toHaveAttribute('data-muted', 'false');
  await expect
    .poll(() => mock.calls.some((c) => c.includes('/v1/me/player/volume?volume_percent=100')))
    .toBe(true);
  expect(errors).toEqual([]);
});

test('Spotify without an active device: one clear warning, the workout keeps running', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(60_000);
  await mockSpotify(page, []);
  await connectSpotify(page);

  const name = `E2E NoDevice ${Date.now()}`;
  await buildWorkoutWithSpotifyTrack(page, name);
  await rideIt(page, name);
  await page.keyboard.press('Space');

  await expect(page.getByTestId('toast-stack')).toContainText(
    'Open Spotify on a phone or computer',
    { timeout: 15_000 },
  );
  await expect(page.getByTestId('now-playing')).toHaveCount(0);
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running');
});

test('editor: a YouTube video that cannot be embedded is marked with a warning', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  await page.route('https://www.youtube.com/oembed**', (route) =>
    route.fulfill({ status: 401, headers: CORS, body: 'Unauthorized' }),
  );
  await page.goto('./#/editor/new');
  await page.getByTestId('editor-block').nth(1).click();
  await page.getByTestId('track-url').fill('https://youtu.be/dQw4w9WgXcQ');
  await page.getByRole('button', { name: 'Pin track' }).click();
  await expect(page.getByTestId('track-not-embeddable')).toContainText('cannot be embedded');
  await expect(page.getByTestId('music-pill')).toContainText('⚠');
});

test('Polish: settings and the editor search hint are translated', async ({ page }, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'language', { value: 'pl-PL', configurable: true });
  });
  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { name: 'Muzyka', level: 2 })).toBeVisible();
  await expect(page.getByLabel('Client ID Spotify')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Połącz Spotify' })).toBeVisible();
  await shot(page, 'settings-music-pl');
  await page.goto('./#/editor/new');
  await page.getByTestId('editor-block').nth(1).click();
  await expect(page.getByTestId('spotify-search-hint')).toContainText('Połącz Spotify');
});

test('now-playing corner: lays out clear of the HUD in the players, Immersive and Column layouts', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(180_000);
  await page.goto('about:blank');
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  });
  test.skip(!webgl, 'WebGL is not available in this headless browser');

  await mockSpotify(page, [{ id: 'D-PC', name: 'My PC', type: 'Computer', is_active: true }]);
  await connectSpotify(page);
  const name = `E2E Layouts ${Date.now()}`;
  await buildWorkoutWithSpotifyTrack(page, name);

  await rideWithRider(page, name, true);
  const corner = page.getByTestId('now-playing');
  await expect(corner).toBeVisible({ timeout: 20_000 });

  for (const [w, h] of [
    [1920, 1080],
    [1280, 720],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    // Basic-style layouts first would need a restart; the three World layouts cycle with H.
    for (const layout of ['immersive', 'column'] as const) {
      while ((await page.getByTestId(`layout-${layout}`).count()) === 0) {
        await page.keyboard.press('h');
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(500);
      await shot(page, `corner-${layout}-${w}`);
      expect(await underCorner(page), `${layout} at ${w}`).toEqual([]);
    }
    // Players off/on does not move the corner.
    await page.keyboard.press('g');
    await page.waitForTimeout(300);
    await shot(page, `corner-players-toggled-${w}`);
    expect(await underCorner(page), `toggled players at ${w}`).toEqual([]);
    await page.keyboard.press('g');
  }
});

test('now-playing corner: lays out clear of the HUD in the Basic players layout', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(120_000);
  await mockSpotify(page, [{ id: 'D-PC', name: 'My PC', type: 'Computer', is_active: true }]);
  await connectSpotify(page);
  const name = `E2E Players ${Date.now()}`;
  await buildWorkoutWithSpotifyTrack(page, name);
  await rideWithRider(page, name, false);
  await expect(page.getByTestId('now-playing')).toBeVisible({ timeout: 20_000 });
  for (const [w, h] of [
    [1920, 1080],
    [1280, 720],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await shot(page, `corner-players-${w}`);
    expect(await underCorner(page), `players at ${w}`).toEqual([]);
  }
});
