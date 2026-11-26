import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Ride shortcuts for keyboards, media keys and presentation remotes: "?" lists them, the media
// Play/Pause key pauses and resumes, and the trainer keys do nothing without a trainer.

async function openTraining(page: Page): Promise<void> {
  await page.clock.install();
  await page.goto('./?dev#/dev');
  const row = page.getByTestId('workout-row').filter({ hasText: 'Demo mix' });
  await row.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
}

test('ride shortcuts: "?" help, media play/pause, trainer keys without a trainer', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'local', 'the dev menu is in the local build');
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await openTraining(page);
  const screen = page.getByTestId('training-screen');

  // "?" shows the list (the character, whatever key types it); Escape closes it.
  await page.keyboard.press('Shift+Slash');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help).toContainText('Next song');
  await expect(help).toContainText('Harder (trainer in ERG)');
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  // A click outside takes the focus away: Escape still closes it, and so does the backdrop.
  await page.keyboard.press('Shift+Slash');
  await expect(help).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(help).toBeHidden();
  await page.keyboard.press('Shift+Slash');
  await help.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  // A phone held sideways: a 44 px Close and keys of at least 12 px.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.keyboard.press('Shift+Slash');
  const close = help.getByRole('button', { name: 'Close' });
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const kbd = await help
    .locator('kbd')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(kbd).toBeGreaterThanOrEqual(12);
  if (process.env.SHOTS_DIR) {
    // The page clock holds the opening animation at its start: show the list without it.
    await help.evaluate((el) => {
      for (const a of [...el.getAnimations(), ...el.parentElement!.getAnimations()]) a.finish();
    });
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/844x390-shortcuts-help.png` });
  }
  await close.click();
  await expect(help).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });
  // Escape closed the help only: no end dialog, the ride is still idle.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(screen).toHaveAttribute('data-status', 'idle');

  // The media Play/Pause key (keyboards, remotes) starts, pauses and resumes like Space.
  await page.keyboard.press('MediaPlayPause');
  await expect(screen).toHaveAttribute('data-status', 'countdown');
  await page.clock.runFor(3100);
  await expect(screen).toHaveAttribute('data-status', 'running');
  await page.keyboard.press('MediaPlayPause');
  await expect(screen).toHaveAttribute('data-status', 'paused');
  await page.keyboard.press('MediaPlayPause');
  await expect(screen).toHaveAttribute('data-status', 'running');

  // No trainer: ↑ / ↓ / + / - and N leave the ride as it is.
  const block = (await page.getByTestId('timeline').textContent()) ?? '';
  for (const key of ['ArrowUp', 'ArrowDown', 'Equal', 'Minus', 'KeyN'])
    await page.keyboard.press(key);
  await expect(screen).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('timeline')).toContainText(block.slice(0, 12));
  expect(errors).toEqual([]);
});
