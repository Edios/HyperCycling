import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// "Match music" end to end: the wizard from a workout preview, the visible YouTube player in the
// preview and in the ride, and the ride with the matched songs. Rides autosave to the shared local
// database, so this runs on the pages build only. YouTube's IFrame API is replaced by a stub that
// plays instantly (nothing touches the network, and the browser is muted anyway).

const SHOTS = process.env.SHOTS_DIR ?? '';
const shot = async (page: Page, name: string): Promise<void> => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const FAKE_API = `
window.__yt = { calls: [], frames: 0 };
window.YT = {
  Player: function (el, opts) {
    window.__yt.frames++;
    var frame = document.createElement('div');
    frame.setAttribute('data-testid', 'fake-yt-player');
    frame.style.cssText = 'width:' + opts.width + 'px;height:' + opts.height + 'px;background:#1d3557;';
    el.appendChild(frame);
    var target = {
      playVideo: function () { window.__yt.calls.push('play'); },
      pauseVideo: function () { window.__yt.calls.push('pause'); },
      mute: function () {}, unMute: function () {},
      setVolume: function (v) { window.__yt.calls.push('volume:' + v); },
      destroy: function () { window.__yt.calls.push('destroy'); },
      loadVideoById: function (o) {
        window.__yt.calls.push('load:' + o.videoId + '@' + (o.startSeconds || 0));
        setTimeout(function () { opts.events.onStateChange({ target: target, data: 1 }); }, 20);
      }
    };
    window.__yt.calls.push('create:' + opts.videoId + '@' + (opts.playerVars.start || 0));
    setTimeout(function () {
      opts.events.onReady({ target: target });
      setTimeout(function () { opts.events.onStateChange({ target: target, data: 1 }); }, 20);
    }, 30);
    return target;
  }
};
setTimeout(function () { window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(); }, 0);
`;

async function stubYoutube(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_API }),
  );
}

const ytCalls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __yt?: { calls: string[] } }).__yt?.calls ?? []);

async function toWizard(page: Page): Promise<void> {
  await page.goto('./#/freestyle');
  await page.getByRole('searchbox').fill('Climbs to Music');
  await page.getByTestId('workout-card').first().click();
  await page.getByTestId('workout-match-music').click();
  await expect(page.getByTestId('soundtrack-wizard')).toBeVisible();
}

async function startRunning(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await expect(async () => {
    if ((await page.getByTestId('training-screen').getAttribute('data-status')) === 'idle')
      await page.keyboard.press('Space');
    await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
      timeout: 1500,
    });
  }).toPass({ timeout: 20_000 });
  // The corner label gives way to the player's own caption, so it is only attached.
  await expect(page.getByTestId('now-playing')).toBeAttached({ timeout: 20_000 });
}

/** Everything wrong with the music player on the ride screen, as readable lines. */
function dockProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const TOL = 1.5;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out: string[] = [];
    const dock = document.querySelector<HTMLElement>('[data-testid="music-dock"]');
    const frame = document.querySelector<HTMLElement>('[data-testid="music-player-frame"]');
    if (!dock || dock.getAttribute('data-visible') !== 'true') return ['the player is not shown'];
    const d = dock.getBoundingClientRect();
    const f = frame?.getBoundingClientRect();
    if (!f || f.width < 199.5 || f.height < 199.5)
      out.push(`the player is ${f?.width}x${f?.height}, YouTube asks for 200x200 at least`);
    if (d.left < -TOL || d.top < -TOL || d.right > vw + TOL || d.bottom > vh + TOL)
      out.push(`the player is outside the screen ${JSON.stringify(d)}`);
    const name = document.querySelector('[data-testid="music-player-name"]');
    if (!name?.textContent?.trim()) out.push('the player shows no title');
    const hide = document
      .querySelector('[data-testid="music-player-hide"]')
      ?.getBoundingClientRect();
    if (!hide || hide.width < 43 || hide.height < 43) out.push('the hide button is under 44 px');
    // The HUD is laid out beside or above the player (never under it): no panel, no control.
    const panels = [
      ...document.querySelectorAll<HTMLElement>('[data-g], [data-testid="controls"]'),
    ].filter((p) => p.getBoundingClientRect().width > 0 && !p.closest('[data-hidden]'));
    const others = panels;
    for (const p of others) {
      const r = p.getBoundingClientRect();
      const ox = Math.min(d.right, r.right) - Math.max(d.left, r.left);
      const oy = Math.min(d.bottom, r.bottom) - Math.max(d.top, r.top);
      if (ox > 2 && oy > 2)
        out.push(
          `the player overlaps ${p.getAttribute('data-g') ?? p.getAttribute('data-testid')}`,
        );
    }
    // The tiles stay whole in what is left: inside the screen, text inside its panel (a little
    // slack for the line box), panels not on each other. This is the geometry the HUD keeps
    // without a player (training-hud-geometry.spec), held with it too.
    for (const p of panels) {
      const r = p.getBoundingClientRect();
      const g = p.getAttribute('data-g') ?? p.getAttribute('data-testid');
      if (r.left < -TOL || r.right > vw + TOL || r.top < -TOL || r.bottom > vh + TOL)
        out.push(`panel ${g} outside the screen`);
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const text = (n.textContent ?? '').trim();
        const el = n.parentElement;
        if (!text || !el || getComputedStyle(el).visibility === 'hidden') continue;
        if (el.closest('.sr-only, [aria-hidden="true"]')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const t = range.getBoundingClientRect();
        if (t.width === 0 || t.height === 0) continue;
        const slack = t.height * 0.2;
        if (t.left < r.left - TOL || t.right > r.right + TOL)
          out.push(`text "${text}" sticks out of panel ${g} sideways`);
        if (t.top < r.top - slack || t.bottom > r.bottom + slack)
          out.push(`text "${text}" sticks out of panel ${g} vertically`);
      }
    }
    for (let i = 0; i < panels.length; i += 1) {
      for (let j = i + 1; j < panels.length; j += 1) {
        const a = panels[i]!.getBoundingClientRect();
        const b = panels[j]!.getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) out.push(`panels ${i} and ${j} overlap`);
      }
    }
    return out;
  });
}

const VIEWPORTS = [
  { width: 1280, height: 800, name: 'pc' },
  { width: 844, height: 390, name: 'phone-landscape' },
  { width: 390, height: 844, name: 'phone-portrait' },
];

test.describe('Match music', () => {
  test('wizard: kinds, songs, preview with the visible player, shuffle, lock, replace, done', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'pages', 'runs on the pages build only');
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
    await startRunning(page);

    const found: string[] = [];
    for (const v of VIEWPORTS) {
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.mouse.move(3, 3);
      await page.mouse.move(8, 8);
      await page.waitForTimeout(400);
      const portrait = v.name === 'phone-portrait';
      if (portrait) {
        // No room beside the HUD on a phone in portrait: the player waits for the rider's word.
        await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
        await expect(page.getByTestId('now-playing')).toBeVisible();
        await shot(page, 'soundtrack-ride-phone-portrait-default');
        await page.getByRole('button', { name: 'Quick settings' }).click();
        await page.getByRole('switch', { name: 'Music player' }).check();
        await page.getByRole('button', { name: 'Close' }).click();
        await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'true');
      }
      await shot(page, `soundtrack-ride-${v.name}`);
      found.push(...(await dockProblems(page)).map((m) => `${v.name}: ${m}`));
      if (portrait) {
        await page.getByTestId('music-player-hide').click();
        await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
      }
    }
    expect(found).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 800 });
    // The landscape sizes after the portrait one: the rider's "off" holds there too.
    await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
    await page.getByRole('button', { name: 'Quick settings' }).click();
    await page.getByRole('switch', { name: 'Music player' }).check();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('music-dock')).toHaveAttribute('data-visible', 'true');

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
