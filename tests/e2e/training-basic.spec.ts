import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The page clock is installed before navigation so performance.now and rAF are controllable. */
async function openTraining(page: Page, buttonName: 'Ride' | 'Ride with players'): Promise<void> {
  await page.clock.install();
  await page.goto('./?dev#/dev');
  // The deterministic demo workout is not the first row since the built-in content landed.
  const row = page.getByTestId('workout-row').filter({ hasText: 'Demo mix' });
  await row.getByRole('button', { name: buttonName, exact: true }).click();
  await expect(page.getByTestId('training-screen')).toBeVisible();
}

const status = (page: Page) => page.getByTestId('training-screen');

test('solo: countdown, running, block change, pause, skip, finish, summary', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await openTraining(page, 'Ride');
  await expect(page.getByTestId('layout-solo')).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-status', 'idle');

  await page.keyboard.press('Space');
  await expect(status(page)).toHaveAttribute('data-status', 'countdown');
  await expect(page.getByTestId('countdown')).toHaveText('3');
  await page.clock.runFor(1000);
  await expect(page.getByTestId('countdown')).toHaveText('2');
  await page.clock.runFor(2100);
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('timeline')).toContainText('block 1 of');

  // Skip the 2-minute warm-up ramp, then let the 30 s push block end on its own.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('timeline')).toContainText('block 2 of');
  await expect(page.getByTestId('effort-value')).toContainText('7');
  await page.clock.runFor(30_500);
  await expect(page.getByTestId('timeline')).toContainText('block 3 of');
  await expect(page.getByTestId('effort-value')).toContainText('3');

  // Space pauses: time stays frozen while the clock runs.
  await page.keyboard.press('Space');
  await expect(status(page)).toHaveAttribute('data-status', 'paused');
  const frozen = (await page.getByTestId('block-timer').textContent()) ?? '';
  await page.clock.runFor(5000);
  await expect(page.getByTestId('block-timer')).toHaveText(frozen);
  await page.keyboard.press('Space');
  await expect(status(page)).toHaveAttribute('data-status', 'running');

  // ArrowRight skips to the next block.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('timeline')).toContainText('block 4 of');

  // A long jump ends the workout and lands on the summary placeholder.
  await page.clock.fastForward(3_600_000);
  await expect(page.getByTestId('summary-screen')).toBeVisible();
  await expect(page.getByTestId('summary-name')).toHaveText('Demo mix');
  await expect(page.getByTestId('summary-status')).toHaveText('Completed');

  await page.getByRole('button', { name: 'Back to plan' }).click();
  await expect(page.getByRole('link', { name: 'Freestyle' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Escape asks before ending and goes to the summary', async ({ page }) => {
  await openTraining(page, 'Ride');
  await expect(async () => {
    await page.keyboard.press('Space');
    await expect(status(page)).toHaveAttribute('data-status', 'countdown', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.clock.runFor(8000);
  await page.keyboard.press('Escape');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('End workout?');
  await dialog.getByRole('button', { name: 'Back to workout' }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page)).toHaveAttribute('data-status', 'running');

  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('button', { name: 'End and see summary' }).click();
  await expect(page.getByTestId('summary-status')).toHaveText('Ended early');
  await expect(page.getByTestId('summary-ridden')).toHaveText('0:05');
});

test('players: shows target watts for both players', async ({ page }) => {
  await openTraining(page, 'Ride with players');
  const list = page.getByTestId('players-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Mirek');
  await expect(list).toContainText('Ania');
  // Ramp starts at effort 2 (55 % FTP): 270 -> 149 W, 190 -> 105 W.
  await expect(list).toContainText('149 W');
  await expect(list).toContainText('105 W');

  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('layout-solo')).toBeVisible();
});

const inside = (
  inner: { x: number; y: number; width: number; height: number },
  outer: typeof inner,
) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]) {
  for (const [name, text] of [
    ['Long block 59:59', '59:59'],
    ['Long block 1:00:00', '1:00:00'],
  ] as const) {
    for (const button of ['Ride', 'Ride with players'] as const) {
      test(`big numbers fit their tiles: ${text} ${button} at ${size.width}x${size.height}`, async ({
        page,
      }) => {
        await page.setViewportSize(size);
        await page.clock.install();
        await page.goto('./?dev#/dev');
        const row = page.getByTestId('workout-row').filter({ hasText: name });
        await row.getByRole('button', { name: button, exact: true }).click();
        await expect(page.getByTestId('training-screen')).toBeVisible();

        await expect(page.getByTestId('block-timer-value')).toHaveText(text);
        await page.evaluate(() => document.fonts.ready);
        // Each big number (the text, not its box) stays inside its panel with padding to spare.
        for (const [valueId, tileId] of [
          ['block-timer-value', 'block-timer'],
          ['rpm-value-number', 'rpm-value'],
        ] as const) {
          // Polled: the first measurement can land before the web font and the fitted size settle.
          await expect
            .poll(
              async () => {
                const tile = (await page.getByTestId(tileId).boundingBox())!;
                const box = await page.getByTestId(valueId).evaluate((el) => {
                  const r = document.createRange();
                  r.selectNodeContents(el);
                  const b = r.getBoundingClientRect();
                  return { x: b.x, y: b.y, width: b.width, height: b.height };
                });
                return (
                  inside(box, tile) &&
                  box.x - tile.x > tile.width * 0.03 &&
                  tile.x + tile.width - (box.x + box.width) > tile.width * 0.03
                );
              },
              { message: valueId },
            )
            .toBe(true);
        }
        // The effort number sits inside its ring.
        await expect(page.getByTestId('effort-value-number')).toContainText('10');
        const ring = (await page
          .getByTestId('effort-value')
          .getByTestId('effort-ring')
          .boundingBox())!;
        const digits = (await page.getByTestId('effort-value-number').boundingBox())!;
        expect(inside(digits, ring)).toBe(true);
        // The word 'Effort' is inside the ring only from 230 px, else a caption that never overlaps.
        if (await page.getByTestId('effort-ring-word').count()) {
          expect(ring.width).toBeGreaterThanOrEqual(230);
        } else {
          const cap = (await page.getByTestId('effort-caption').boundingBox())!;
          expect(cap.y).toBeGreaterThanOrEqual(digits.y + digits.height - 0.5);
        }

        // Groups: Effort + Next is the right-hand tile, Time is to its left (Measures between).
        const effort = (await page.getByTestId('effort-group').boundingBox())!;
        const timer = (await page.getByTestId('block-timer').boundingBox())!;
        expect(effort.x).toBeGreaterThan(timer.x + timer.width - 0.5);
        const nextBox = (await page.getByTestId('next-block').boundingBox())!;
        expect(inside(nextBox, effort)).toBe(true);

        // Layout: the controls bar is centred and sits below the tiles.
        const controls = (await page.getByTestId('controls').boundingBox())!;
        expect(controls.y).toBeGreaterThanOrEqual(effort.y + effort.height - 0.5);
        expect(Math.abs(controls.x + controls.width / 2 - size.width / 2)).toBeLessThan(2);
      });
    }
  }
}

test('pause, switch background in quick settings, resume: the time carries on', async ({
  page,
}) => {
  await openTraining(page, 'Ride');
  await page.keyboard.press('Space');
  await page.clock.runFor(3100 + 5000);
  await page.keyboard.press('Space');
  await expect(status(page)).toHaveAttribute('data-status', 'paused');
  const frozen = (await page.getByTestId('block-timer').textContent()) ?? '';

  await page.getByRole('button', { name: 'Quick settings' }).click();
  await expect(page.getByTestId('quick-settings')).toBeVisible();
  await page.getByRole('radio', { name: 'World' }).check({ force: true });
  // Without WebGL the screen falls back to Basic; the choice itself is applied either way.
  await expect(page.getByRole('radio', { name: 'World' })).toBeChecked();
  await expect(status(page)).toHaveAttribute('data-status', 'paused');
  await expect(page.getByTestId('block-timer')).toHaveText(frozen);
  // Back to Basic: the software WebGL renderer of headless Chrome would slow the clock-driven run.
  await page.getByRole('radio', { name: 'Basic' }).check({ force: true });
  await expect(page.getByTestId('training-screen')).toHaveAttribute('data-background', 'basic');
  await expect(page.getByTestId('block-timer')).toHaveText(frozen);

  await page.keyboard.press('Escape'); // closes the panel first
  await expect(page.getByTestId('quick-settings')).toBeHidden();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.keyboard.press('Space');
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await page.clock.runFor(3000);
  await expect(page.getByTestId('block-timer')).not.toHaveText(frozen);
  await expect(page.getByTestId('timeline')).toContainText('block 1 of');
});

test('Menu: leave without saving goes home and forgets the ride', async ({ page }) => {
  await openTraining(page, 'Ride');
  await page.keyboard.press('Space');
  await page.clock.runFor(5000);
  await page.mouse.move(600, 300); // the controls fade out while idle
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page.getByTestId('training-screen')).toBeHidden();
  await expect(page.getByTestId('summary-screen')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
});
