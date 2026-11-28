import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedSettings } from './seed-settings';

// Choreography in Neon Grid 30: the summit song is moved so that its drop starts with the first
// standing block, and the HUD counts the stand in on the song's beat. YouTube is a stub whose
// player has a clock (seconds into the video, on the page's fake time).

const CLOCK_API = `
window.__yt = { calls: [] };
window.YT = {
  Player: function (el, opts) {
    var frame = document.createElement('div');
    frame.setAttribute('data-testid', 'fake-yt-player');
    el.appendChild(frame);
    var now = { id: opts.videoId, from: (opts.playerVars && opts.playerVars.start) || 0, at: Date.now(), state: -1 };
    var playing = function () {
      now.state = 1;
      opts.events.onStateChange({ target: target, data: 1 });
    };
    var target = {
      playVideo: function () { now.from = target.getCurrentTime(); now.at = Date.now(); now.state = 1; },
      pauseVideo: function () { now.from = target.getCurrentTime(); now.state = 2; },
      mute: function () {}, unMute: function () {},
      setVolume: function () {},
      destroy: function () {},
      getPlayerState: function () { return now.state; },
      getCurrentTime: function () {
        return now.state === 1 ? now.from + (Date.now() - now.at) / 1000 : now.from;
      },
      getVideoData: function () { return { video_id: now.id }; },
      loadVideoById: function (o) {
        window.__yt.calls.push('load:' + o.videoId + '@' + (o.startSeconds || 0));
        now = { id: o.videoId, from: o.startSeconds || 0, at: Date.now(), state: 3 };
        setTimeout(playing, 20);
      }
    };
    window.__yt.calls.push('create:' + opts.videoId + '@' + now.from);
    setTimeout(function () {
      opts.events.onReady({ target: target });
      setTimeout(playing, 20);
    }, 30);
    return target;
  }
};
setTimeout(function () { window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(); }, 0);
`;

async function startCountdown(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Space');
    await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'countdown', {
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });
}

test('Neon Grid 30: the drop of the summit song meets the stand, counted in on the beat', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: CLOCK_API }),
  );
  await page.clock.install();
  await seedSettings(page, info, null);
  await page.goto('./#/setup/class-neon-grid-30?exp=neon-grid-30');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Neon Grid 30');
  await expect(page.getByRole('switch', { name: 'Music in this ride' })).toBeChecked();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
  await startCountdown(page);
  await page.clock.runFor(3100);
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running');

  // Skip to the summit's first block, where its song starts. (A skip inside one song does not
  // move the music; the HUD follows the song's own clock, so the ride enters the slot here.)
  for (let i = 1; i < 19; i += 1) {
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('timeline')).toContainText(`block ${i + 1} of`);
  }
  await page.clock.runFor(500);
  // Pjanoo starts from the point that puts its third drop on the first stand, 90 s later.
  // (93.5 s into the song at the slot's start; the skip lands a moment later.)
  await expect
    .poll(async () =>
      (
        await page.evaluate(() => (window as unknown as { __yt: { calls: string[] } }).__yt.calls)
      ).some((c) => /^load:HUvovrkygZg@9[34]$/.test(c)),
    )
    .toBe(true);
  await expect(page.getByTestId('choreo-call')).toHaveCount(0);

  // 1.5 s before the stand: "Stand up on the drop", counted down on the beat.
  await page.clock.fastForward(84_000);
  await expect(page.getByTestId('timeline')).toContainText('block 20 of');
  // The lead-in lasts under two seconds and the page clock also runs on its own, so the call is
  // read in the same evaluate that finds it (never "is it there?" and then "what does it say?").
  const readCall = () =>
    page.evaluate(() => {
      const c = document.querySelector('[data-testid="choreo-call"]');
      if (!c) return null;
      const root = document.querySelector('[data-testid="choreo"]');
      return {
        move: c.getAttribute('data-move'),
        on: c.getAttribute('data-on'),
        count: Number(c.getAttribute('data-count')),
        text: c.textContent ?? '',
        onBeat: root?.getAttribute('data-on-beat'),
      };
    });
  let seen = await readCall();
  for (let i = 0; i < 150 && seen === null; i += 1) {
    await page.clock.runFor(100);
    seen = await readCall();
  }
  if (seen === null) throw new Error('the stand was never called');
  expect(seen).toMatchObject({ move: 'stand', on: 'drop', onBeat: 'true' }); // 66 rpm ~ 126 BPM
  expect(seen.text).toContain('Stand up on the drop');
  // The count runs on the song's beat (unit tests check each step); here: one of the lead-in.
  expect(seen.count).toBeGreaterThanOrEqual(1);
  expect(seen.count).toBeLessThanOrEqual(4);

  // Standing now: the call is gone and the song is in its drop.
  await expect(async () => {
    await page.clock.runFor(200);
    await expect(page.getByTestId('timeline')).toContainText('block 21 of', { timeout: 100 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId('choreo-call')).toHaveCount(0);
  await expect(page.getByTestId('choreo')).toHaveAttribute('data-section', 'drop');
  expect(errors).toEqual([]);
});
