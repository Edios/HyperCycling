import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  playerProblems,
  showPlayer,
  startRunningWithMusic,
  stubYoutube,
  wakeControls,
} from './music-player';

// "Match music" end to end: the wizard from a workout preview, the visible YouTube player in the
// preview and in the ride, and the ride with the matched songs. Rides autosave to the shared local
// database, so this runs on the pages build only. YouTube's IFrame API is replaced by a stub that
// plays instantly (nothing touches the network, and the browser is muted anyway).

const SHOTS = process.env.SHOTS_DIR ?? '';
const shot = async (page: Page, name: string): Promise<void> => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const ytCalls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __yt?: { calls: string[] } }).__yt?.calls ?? []);

async function toWizard(page: Page): Promise<void> {
  await page.goto('./#/freestyle');
  await page.getByRole('searchbox').fill('Climbs to Music');
  await page.getByTestId('workout-card').first().click();
  await page.getByTestId('workout-match-music').click();
  await expect(page.getByTestId('soundtrack-wizard')).toBeVisible();
}

const VIEWPORTS = [
  { width: 1280, height: 800, name: 'pc' },
  { width: 844, height: 390, name: 'phone-landscape' },
  { width: 390, height: 844, name: 'phone-portrait' },
  { width: 390, height: 734, name: 'phone-portrait-bar' },
];

test.describe('Match music', () => {
  test('wizard: kinds, songs, preview with the visible player, shuffle, lock, replace, done', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    test.setTimeout(90_000); // axe and many steps, on a busy machine
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await stubYoutube(page);
    await toWizard(page);

    // Step 1
    await expect(page.getByRole('heading', { name: 'What music should play?' })).toBeVisible();
    await expect(page.getByTestId('soundtrack-chip-electronic')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('soundtrack-hint')).toContainText('Best for this ride');
    await page.getByTestId('soundtrack-chip-rock').click();
    for (const v of VIEWPORTS) {
      await page.setViewportSize({ width: v.width, height: v.height });
      await expect(page.getByTestId('soundtrack-next')).toBeInViewport();
      await shot(page, `soundtrack-step1-${v.name}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('soundtrack-next').click();

    // Step 2: songs for every stretch, nothing plays by itself.
    await expect(page.getByRole('heading', { name: 'We suggest these songs' })).toBeVisible();
    const parts = page.getByTestId('soundtrack-part');
    expect(await parts.count()).toBeGreaterThanOrEqual(5);
    expect(await ytCalls(page)).toEqual([]);
    await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');

    // Axe on the step with the songs and the lock and replace buttons.
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(
      axe.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);

    // The preview: a 200 x 200 player with the title, at 30%, from where the song starts.
    await page.getByTestId('soundtrack-play').first().click();
    const dock = page.getByTestId('music-dock');
    await expect(dock).toHaveAttribute('data-visible', 'true');
    const frameBox = await page.getByTestId('music-player-frame').boundingBox();
    expect(frameBox?.width).toBeGreaterThanOrEqual(200);
    expect(frameBox?.height).toBeGreaterThanOrEqual(200);
    await expect(page.getByTestId('music-player-name')).not.toBeEmpty();
    expect((await ytCalls(page)).some((c) => c === 'volume:30')).toBe(true);
    await shot(page, 'soundtrack-step2-preview-pc');
    await page.getByTestId('soundtrack-play').first().click(); // the same button stops it
    await expect(dock).toHaveAttribute('data-visible', 'false');

    // The three screens of the brief.
    for (const v of VIEWPORTS.slice(1).reverse()) {
      await page.setViewportSize({ width: v.width, height: v.height });
      await expect(page.getByTestId('soundtrack-next')).toBeInViewport();
      await shot(page, `soundtrack-step2-${v.name}`);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways, `${v.name} scrolls sideways`).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Shuffle keeps a locked stretch; replace changes one song; a song is never played twice.
    const songs = async (): Promise<string[]> =>
      page
        .getByTestId('soundtrack-song')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-song') ?? ''));
    const before = await songs();
    const lockedSongs = await parts
      .nth(1)
      .getByTestId('soundtrack-song')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-song')));
    await parts.nth(1).getByTestId('soundtrack-lock').click();
    await expect(parts.nth(1).getByTestId('soundtrack-lock')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByTestId('soundtrack-shuffle').click();
    await expect.poll(songs).not.toEqual(before);
    expect(
      await parts
        .nth(1)
        .getByTestId('soundtrack-song')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-song'))),
    ).toEqual(lockedSongs);
    const gone = await parts
      .nth(2)
      .getByTestId('soundtrack-song')
      .first()
      .getAttribute('data-song');
    await parts.nth(2).getByTestId('soundtrack-replace').first().click();
    await expect.poll(songs).not.toContain(gone);
    const all = await songs();
    expect(new Set(all).size).toBe(all.length);

    // Step 3, then the ride setup with the songs on it.
    await page.getByTestId('soundtrack-next').click();
    await expect(page.getByTestId('soundtrack-done')).toContainText('songs for');
    await shot(page, 'soundtrack-step3-pc');
    await page.getByRole('button', { name: 'To the ride' }).click();
    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await expect(page.getByTestId('setup-soundtrack')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('setup-soundtrack')).toContainText('Matched:');
    expect(errors).toEqual([]);
  });

  test('ride: the player is shown with the title, fits the screen on a computer and a phone, hides and shows again', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await stubYoutube(page);
    await toWizard(page);
    await page.getByTestId('soundtrack-next').click();
    await page.getByTestId('soundtrack-next').click();
    await page.getByRole('button', { name: 'To the ride' }).click();
    await expect(page.getByTestId('setup-soundtrack')).toHaveAttribute('data-state', 'ready');
    await startRunningWithMusic(page);

    const found: string[] = [];
    for (const v of VIEWPORTS) {
      await page.setViewportSize({ width: v.width, height: v.height });
      await wakeControls(page);
      // A computer shows the player by default; a mobile device (a phone, in either orientation)
      // only by the rider's word.
      const mobile = v.name !== 'pc';
      if (!mobile) {
        await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'true');
      }
      if (mobile) {
        await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
        await expect(page.getByTestId('now-playing')).toBeVisible();
        await shot(page, `soundtrack-ride-${v.name}-default`);
        await showPlayer(page);
        await wakeControls(page);
      }
      await shot(page, `soundtrack-ride-${v.name}`);
      found.push(...(await playerProblems(page)).map((m) => `${v.name}: ${m}`));
      if (mobile) {
        await page.getByTestId('music-player-hide').click();
        await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
      }
    }
    expect(found).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 800 });
    // The rider's "off" of the phone sizes holds on the computer too; the switch brings it back.
    await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
    await showPlayer(page);

    // The song of the ride is from the matched plan, in YouTube's player.
    expect((await ytCalls(page))[0]).toMatch(/^create:/);

    // Hide it with its own button: the music goes on (nothing paused), the choice is remembered.
    const callsBefore = (await ytCalls(page)).filter((c) => c === 'pause').length;
    await page.getByTestId('music-player-hide').click();
    await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
    await expect(page.getByTestId('now-playing')).toBeVisible();
    expect((await ytCalls(page)).filter((c) => c === 'pause').length).toBe(callsBefore);

    // The quick switch brings it back.
    await page.getByRole('button', { name: 'Quick settings' }).click();
    const toggle = page.getByRole('switch', { name: 'Music player' });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'true');
    await page.getByRole('button', { name: 'Close' }).click();
    expect(errors).toEqual([]);
  });

  test('settings: the player can be turned off, with the note about the responsibility', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
    await page.goto('./#/settings');
    const toggle = page.getByRole('switch', { name: 'Show the music player' });
    await expect(toggle).toBeChecked();
    await expect(page.getByTestId('music-player-hint')).toContainText('200 × 200');
    await toggle.uncheck();
    await expect(page.getByTestId('music-player-off-note')).toContainText(
      'your own responsibility',
    );
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Show the music player' })).not.toBeChecked();
  });
});
