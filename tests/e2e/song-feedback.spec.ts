import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  matchMusicInSetup,
  startRunningWithMusic,
  stubYoutube,
  wakeControls,
} from './music-player';

// The owner's per-song thumbs (energy matching spec §9 J): shown with the ride controls, in the
// player's caption on a computer and in the now-playing label on a phone, and stored on the
// device with the song's context. Pages build only (IndexedDB is read back directly).

const SHOTS = process.env.SHOTS_DIR ?? '';

async function storedFeedback(page: Page): Promise<unknown[]> {
  return page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const req = indexedDB.open('spinning-tutor');
        req.onsuccess = () => {
          const tx = req.result.transaction('songFeedback', 'readonly');
          const all = tx.objectStore('songFeedback').getAll();
          all.onsuccess = () => resolve(all.result as unknown[]);
          all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

test('song thumbs: with the controls only, stored with the song context, on a computer and a phone', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubYoutube(page);
  await matchMusicInSetup(page, 'music-climbs');
  await startRunningWithMusic(page);

  // Computer: the player is shown, the thumbs sit in its caption while the controls are up.
  await wakeControls(page);
  const dock = page.getByTestId('music-dock');
  await expect(dock).toHaveAttribute('data-visible', 'true');
  await dock.getByTestId('rate-up').click();
  await expect(dock.getByTestId('rate-up')).toHaveAttribute('aria-pressed', 'true');
  await dock.getByTestId('rate-love').click();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'song-feedback-pc.png') });

  await expect.poll(async () => (await storedFeedback(page)).length).toBe(1);
  const [rec] = (await storedFeedback(page)) as Record<string, unknown>[];
  expect(rec).toMatchObject({
    schemaVersion: 1,
    workoutId: 'music-climbs',
    rating: 'up',
    love: true,
    track: { provider: 'youtube' },
  });
  expect(rec?.['context']).toMatchObject({
    segmentKind: expect.any(String),
    effort: expect.any(Number),
  });

  // Idle controls: no thumbs on screen (the HUD stays clean).
  await page.waitForTimeout(4500);
  await expect(page.getByTestId('rate-up')).toHaveCount(0);

  // Phone, landscape: the player is off, the thumbs sit in the now-playing label and fit it.
  await page.setViewportSize({ width: 844, height: 390 });
  await wakeControls(page);
  const label = page.getByTestId('now-playing');
  await expect(label).toBeVisible();
  const up = label.getByTestId('rate-down');
  await expect(up).toBeVisible();
  const box = await label.boundingBox();
  const btn = await up.boundingBox();
  expect(box && btn && btn.x + btn.width <= box.x + box.width + 1).toBe(true);
  expect(box && box.x + box.width <= 844).toBe(true);
  // The label stays clear of the ride controls in the middle.
  const firstControl = await page.getByTestId('controls').locator('button').first().boundingBox();
  expect(
    box && firstControl && box.x + box.width <= firstControl.x + 1,
    JSON.stringify({ box, firstControl }),
  ).toBe(true);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'song-feedback-phone-landscape.png') });
  expect(errors).toEqual([]);
});
