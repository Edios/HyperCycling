import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// "Check the music" for an Experience, end to end. Nothing touches the network: YouTube's oEmbed
// and the IFrame API answer from route mocks. The fake player reports an error for ids listed in
// `window.__deadIds` (what a region block looks like) and otherwise starts playing, muted.

const NIGHTCALL = ['MV_3Dpw-BRY', '46qo_V1zcOM', 'ahienBeHUWw', 'Gl8SUy1C9JY'];

const FAKE_IFRAME_API = `
window.__trials = [];
window.YT = { Player: class {
  constructor(el, opts) {
    const dead = (window.__deadIds || []).includes(opts.videoId);
    window.__trials.push({ id: opts.videoId, mute: opts.playerVars && opts.playerVars.mute });
    const self = { mute() { this.muted = true; }, unMute() {}, playVideo() {}, pauseVideo() {}, destroy() {}, muted: false };
    el.replaceWith(document.createElement('iframe'));
    setTimeout(() => {
      if (dead) { opts.events.onError({ target: self, data: 150 }); return; }
      opts.events.onReady({ target: self });
      opts.events.onStateChange({ target: self, data: 1 });
    }, 10);
  }
} };
if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
`;

async function mockYoutube(page: Page, dead: string[]): Promise<void> {
  await page.addInitScript((ids) => {
    (window as unknown as { __deadIds: string[] }).__deadIds = ids;
  }, dead);
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_IFRAME_API }),
  );
  await page.route('https://www.youtube.com/oembed**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Song', author_name: 'Artist' }),
    }),
  );
}

test('checks the music silently and shows every slot as ready', async ({ page }) => {
  await mockYoutube(page, []);
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await expect(page.getByTestId('exp-check-notrun')).toBeVisible();
  await page.getByTestId('exp-check-run').click();
  const slots = page.getByTestId('exp-check-slot');
  await expect(slots).toHaveCount(11, { timeout: 20_000 });
  for (const slot of await slots.all()) await expect(slot).toHaveAttribute('data-health', 'green');
  await expect(page.getByTestId('exp-check-blocked')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled();
  // Every trial embed asked for mute (no sound while checking).
  const trials = await page.evaluate(
    () => (window as unknown as { __trials: { mute?: number }[] }).__trials,
  );
  expect(trials.length).toBeGreaterThan(11);
  expect(trials.every((t) => t.mute === 1)).toBe(true);
});

test('a slot where no upload plays blocks Start and points to Spotify', async ({ page }) => {
  await mockYoutube(page, NIGHTCALL);
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await page.getByTestId('exp-check-run').click();
  const blocked = page.getByTestId('exp-check-blocked');
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText('1, 8');
  await expect(page.getByTestId('exp-check-slot').first()).toHaveAttribute('data-health', 'red');
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
  // Only a backup plays for the others: nothing else is red.
  await expect(page.locator('[data-testid="exp-check-slot"][data-health="red"]')).toHaveCount(2);
});

test('a dead main upload alone is only a yellow warning', async ({ page }) => {
  await mockYoutube(page, [NIGHTCALL[0]!]);
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  await page.getByTestId('exp-check-run').click();
  await expect(page.getByTestId('exp-check-slot').first()).toHaveAttribute('data-health', 'yellow');
  await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled();
});

test('on an IP address origin the page says YouTube will not play there', async ({ page }) => {
  await mockYoutube(page, []);
  await page.goto('./#/setup/class-neon-grid-45?exp=neon-grid-45');
  const onIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(new URL(page.url()).hostname);
  const note = page.getByTestId('exp-check-ip');
  if (onIp) {
    await expect(note).toBeVisible();
    await expect(note).toContainText(/localhost|hypercycling\.app|Spotify/);
  } else {
    await expect(note).toHaveCount(0);
  }
});
