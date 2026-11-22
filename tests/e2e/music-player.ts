import type { Page } from '@playwright/test';
import { expect } from './fixtures';

// Shared by soundtrack.spec.ts and training-hud-geometry.spec.ts: YouTube's IFrame API stub, the
// way to a ride with matched music (a visible YouTube player) and the geometry the HUD must keep
// while that player is on screen.

export const FAKE_API = `
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

export async function stubYoutube(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_API }),
  );
}

/** Match music for a workout (defaults of the wizard) and come back to its ride setup. */
export async function matchMusicInSetup(page: Page, workoutId: string): Promise<void> {
  await page.goto(`./#/setup/${workoutId}`);
  await page.getByTestId('setup-match-music').click();
  await expect(page.getByTestId('soundtrack-wizard')).toBeVisible();
  await page.getByTestId('soundtrack-next').click();
  await page.getByTestId('soundtrack-next').click();
  await page.getByRole('button', { name: 'To the ride' }).click();
  await expect(page.getByTestId('setup-soundtrack')).toHaveAttribute('data-state', 'ready');
}

/** From the ride setup: start, run, and wait until a YouTube song plays. */
export async function startRunningWithMusic(page: Page): Promise<void> {
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

/**
 * Makes sure the player is shown. A mobile device (a phone, in either orientation) shows it only
 * by the rider's word (the quick settings switch); a computer has it on already.
 */
export async function showPlayer(page: Page): Promise<void> {
  const dock = page.getByTestId('music-dock');
  if ((await dock.getAttribute('data-visible')) === 'true') return;
  // The auto-hidden bar is inert until the pointer moves: wake it and press, again if it fell
  // asleep in between (a busy machine).
  await expect(async () => {
    await wakeControls(page);
    await page.getByRole('button', { name: 'Quick settings' }).click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole('switch', { name: 'Music player' }).check();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(dock).toHaveAttribute('data-visible', 'true');
}

/**
 * Everything wrong with the HUD while the music player is shown, as readable lines: the player
 * is at least 200 x 200 and on screen with a title and a 44 px hide button; no panel or control
 * lies under it; every panel is on screen, its text inside it, panels do not overlap; the control
 * buttons are round touch targets on screen.
 */
export function playerProblems(page: Page): Promise<string[]> {
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

    // The control bar auto-hides: a hidden one is a defect here, the caller moves the pointer.
    const bar = document.querySelector('[data-testid="controls"]');
    if (bar?.getAttribute('data-hidden') === 'true') out.push('controls bar is hidden');
    for (const b of document.querySelectorAll<HTMLElement>('[data-testid="controls"] button')) {
      const r = b.getBoundingClientRect();
      if (b.getClientRects().length === 0) continue; // dropped on purpose on a phone in portrait
      const label = b.getAttribute('aria-label') ?? '?';
      if (Math.abs(r.width - r.height) > 1) out.push(`button "${label}" is not 1:1`);
      if (r.width < 43) out.push(`button "${label}" is only ${r.width.toFixed(1)}px wide`);
      if (r.left < -TOL || r.right > vw + TOL || r.top < -TOL || r.bottom > vh + TOL)
        out.push(`button "${label}" outside the screen`);
    }

    // On a phone in portrait the overlay layouts (World) are not laid out above a band: the player
    // overlays their tiles on purpose ('over'), but never the controls or the timeline.
    const over = document.querySelector('[data-player]')?.getAttribute('data-player') === 'over';
    const panels = [
      ...document.querySelectorAll<HTMLElement>('[data-g], [data-testid="controls"]'),
    ].filter(
      (p) =>
        p.getBoundingClientRect().width > 0 &&
        !p.closest('[data-hidden]') &&
        getComputedStyle(p).visibility !== 'hidden',
    );
    const label = (p: HTMLElement): string => p.getAttribute('data-g') ?? p.dataset.testid ?? '?';
    for (const p of panels) {
      const r = p.getBoundingClientRect();
      const ox = Math.min(d.right, r.right) - Math.max(d.left, r.left);
      const oy = Math.min(d.bottom, r.bottom) - Math.max(d.top, r.top);
      const keepsClear = !over || label(p) === 'controls' || label(p) === 'P';
      if (ox > 2 && oy > 2 && keepsClear) out.push(`the player overlaps ${label(p)}`);
      // The overlay layouts in portrait with the browser's address bar showing (390 x 734) already
      // push the timeline (P) below the screen without any player: not this invariant's business.
      const knownOverflow = over && label(p) === 'P' && r.top < vh;
      if (
        !knownOverflow &&
        (r.left < -TOL || r.right > vw + TOL || r.top < -TOL || r.bottom > vh + TOL)
      )
        out.push(`panel ${label(p)} outside the screen`);
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
          out.push(`text "${text}" sticks out of panel ${label(p)} sideways`);
        if (t.top < r.top - slack || t.bottom > r.bottom + slack)
          out.push(`text "${text}" sticks out of panel ${label(p)} vertically`);
      }
    }
    for (let i = 0; i < panels.length; i += 1) {
      for (let j = i + 1; j < panels.length; j += 1) {
        const a = panels[i]!.getBoundingClientRect();
        const b = panels[j]!.getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2)
          out.push(`panels ${label(panels[i]!)} and ${label(panels[j]!)} overlap`);
      }
    }
    return out;
  });
}

/** The pointer wakes the auto-hiding controls; the measurements follow after a pause. */
export async function wakeControls(page: Page): Promise<void> {
  await page.mouse.move(3, 3);
  await page.mouse.move(8, 8);
  await page.waitForTimeout(450);
}
