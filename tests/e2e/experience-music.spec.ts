import path from 'node:path';
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures';

// "Match songs from Spotify" for an Experience, end to end on the pages build. Spotify answers
// from route mocks (nothing touches the network): every suggestion is found, except one that is
// blocked in the rider's country.

const SHOTS = process.env.SHOTS_DIR ?? '';
const shot = async (page: Page, name: string): Promise<void> => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

async function mockSpotify(page: Page): Promise<string[]> {
  const queries: string[] = [];
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
    if (url.pathname !== '/v1/search') return route.fulfill({ status: 204, headers: CORS });
    const q = url.searchParams.get('q') ?? '';
    queries.push(`${q} | market=${url.searchParams.get('market')}`);
    const m = /^track:(.*) artist:(.*)$/.exec(q);
    if (!m) return json({ tracks: { items: [] } });
    const [, title = '', artist = ''] = m;
    const id = Buffer.from(`${artist}${title}`).toString('hex').slice(0, 22);
    return json({
      tracks: {
        items: [
          {
            id,
            name: title,
            duration_ms: 230_000,
            artists: [{ name: artist }],
            explicit: false,
            is_playable: artist !== 'Kavinsky',
          },
        ],
      },
    });
  });
  return queries;
}

test('matches the suggested songs to Spotify, approves them and keeps them', async ({ page }) => {
  const queries = await mockSpotify(page);
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  // Not connected yet: a link to Settings instead of the button.
  await expect(page.getByTestId('exp-music-connect')).toBeVisible();
  await expect(page.getByTestId('exp-music-match')).toHaveCount(0);
  await shot(page, 'experience-music-offline');

  await page.goto('./#/settings');
  await page.getByLabel('Spotify Client ID').fill('e2eclientid');
  await page.getByTestId('spotify-connect').click();
  await expect(page.getByTestId('spotify-status')).toHaveAttribute('data-connected', 'true');

  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await page.getByTestId('exp-music-match').click();
  await expect(page.getByTestId('exp-music-row')).toHaveCount(11);
  expect(queries.every((q) => q.endsWith('market=from_token'))).toBe(true);
  // Nightcall is blocked in the mocked country: its slot shows a stand-in from the reserve.
  const row = page.getByTestId('exp-music-row').first();
  await expect(row.locator('[data-how="replaced"]')).toHaveCount(1);
  await expect(page.locator('[data-how="found"]').first()).toBeVisible();
  // Manual changes live in the collapsed "Advanced" section; the queue is editable there.
  const advanced = row.getByTestId('exp-music-advanced');
  await expect(advanced).not.toHaveAttribute('open', '');
  await advanced.locator('summary').click();
  await expect(row.getByTestId('exp-music-edit-item').first()).toBeVisible();
  await page.getByTestId('exp-music-review').scrollIntoViewIfNeeded();
  await shot(page, 'experience-music-review');

  await page.getByTestId('exp-music-approve').click();
  await expect(page.getByTestId('exp-music-state')).toContainText('11');
  await shot(page, 'experience-music-saved');

  // The choice survives a reload (kept in this browser).
  await page.reload();
  await expect(page.getByTestId('exp-music-state')).toContainText('11');
  await expect(page.getByTestId('setup-experience')).toBeVisible();
});
