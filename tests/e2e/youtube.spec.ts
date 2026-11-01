import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Sessions autosave to the shared local database, so this runs on the pages build only
// (it has its own IndexedDB per test). The real YouTube API is replaced by a stub script.

const FAKE_API = `
window.__yt = { calls: [], vars: null, videoId: null };
window.YT = {
  Player: function (el, opts) {
    window.__yt.vars = opts.playerVars;
    window.__yt.videoId = opts.videoId;
    var frame = document.createElement('div');
    frame.setAttribute('data-testid', 'fake-yt-player');
    el.appendChild(frame);
    var target = {
      playVideo: function () { window.__yt.calls.push('play'); },
      pauseVideo: function () { window.__yt.calls.push('pause'); },
      mute: function () { window.__yt.calls.push('mute'); },
      unMute: function () { window.__yt.calls.push('unmute'); },
      destroy: function () { window.__yt.calls.push('destroy'); }
    };
    setTimeout(function () {
      var code = window.__ytErrorCode;
      if (code) opts.events.onError({ target: target, data: code });
      else opts.events.onReady({ target: target });
    }, 50);
    return target;
  }
};
setTimeout(function () { window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(); }, 0);
`;

async function stubYoutube(page: Page, errorCode?: number): Promise<void> {
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_API }),
  );
  if (errorCode !== undefined) {
    await page.addInitScript((c) => {
      (window as unknown as { __ytErrorCode: number }).__ytErrorCode = c;
    }, errorCode);
  }
}

async function startYoutube(page: Page): Promise<void> {
  await page.goto('./#/setup/demo-mixed');
  await page.getByRole('button', { name: /YouTube/ }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await page.getByLabel('YouTube link').fill('https://youtu.be/dQw4w9WgXcQ?t=1m30s');
  await expect(page.getByRole('radio', { name: 'Immersive' })).toBeChecked();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test('YouTube: video plays muted behind the HUD, follows pause, no console errors', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  const errors = collectErrors(page);
  await stubYoutube(page);
  await startYoutube(page);

  await expect(page.getByTestId('youtube-background')).toBeVisible();
  await expect(page.getByTestId('fake-yt-player')).toBeAttached();
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-background', 'youtube');
  await expect(page.getByTestId('effort-value')).toBeVisible();
  await expect(page.getByTestId('block-timer')).toBeVisible();

  const vars = await page.evaluate(
    () => (window as never as { __yt: { vars: unknown } }).__yt.vars,
  );
  expect(vars).toMatchObject({ mute: 1, loop: 1, playlist: 'dQw4w9WgXcQ', start: 90, controls: 0 });

  await page.keyboard.press('Space');
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'running', {
    timeout: 8000,
  });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-status', 'paused');
  await expect
    .poll(() =>
      page.evaluate(() => (window as never as { __yt: { calls: string[] } }).__yt.calls.at(-1)),
    )
    .toBe('pause');
  expect(errors).toEqual([]);
});

test('YouTube: embedding blocked (101) shows a toast and falls back to Basic dark', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  await stubYoutube(page, 101);
  await startYoutube(page);

  await expect(
    page.getByText('This video cannot be embedded. Using the Basic background.'),
  ).toBeVisible();
  await expect(page.getByTestId('youtube-background')).toHaveCount(0);
  const root = page.getByTestId('training-screen');
  await expect(root).toHaveAttribute('data-background', 'basic');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('effort-value')).toBeVisible();
});
