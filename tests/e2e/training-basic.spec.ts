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
  await expect(page.getByTestId('block-timer')).toContainText('block 1 of');

  // Skip the 2-minute warm-up ramp, then let the 30 s push block end on its own.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('block-timer')).toContainText('block 2 of');
  await expect(page.getByTestId('effort-value')).toContainText('7');
  await page.clock.runFor(30_500);
  await expect(page.getByTestId('block-timer')).toContainText('block 3 of');
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
  await expect(page.getByTestId('block-timer')).toContainText('block 4 of');

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
  await page.keyboard.press('Space');
  await page.clock.runFor(8000);
  await page.keyboard.press('Escape');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('End workout?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
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
        // Each big number (the text, not its tile-wide box) stays inside its tile with padding to spare.
        for (const [valueId, tileId] of [
          ['block-timer-value', 'block-timer'],
          ['effort-value-number', 'effort-value'],
          ['rpm-value-number', 'rpm-value'],
        ] as const) {
          const tile = (await page.getByTestId(tileId).boundingBox())!;
          const box = await page.getByTestId(valueId).evaluate((el) => {
            const r = document.createRange();
            r.selectNodeContents(el);
            const b = r.getBoundingClientRect();
            return { x: b.x, y: b.y, width: b.width, height: b.height };
          });
          expect(inside(box, tile), valueId).toBe(true);
          expect(box.x - tile.x, valueId).toBeGreaterThan(tile.width * 0.03);
          expect(tile.x + tile.width - (box.x + box.width), valueId).toBeGreaterThan(
            tile.width * 0.03,
          );
        }
        await expect(page.getByTestId('effort-value-number')).toContainText('10');

        // Shared bottom edge: the big numbers in the row end on the same bottom edge.
        const bottoms = await Promise.all(
          ['effort-value-number', 'rpm-value-number', 'block-timer-value'].map(async (id) => {
            // Layout box (offsetParent chain), unaffected by the flip/pulse transforms.
            return page.getByTestId(id).evaluate((el) => {
              let y = 0;
              for (
                let n: HTMLElement | null = el as HTMLElement;
                n;
                n = n.offsetParent as HTMLElement | null
              )
                y += n.offsetTop;
              return y + (el as HTMLElement).offsetHeight;
            });
          }),
        );
        expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(2);

        // Layout: NEXT card centred, controls bar right below it, also centred.
        const next = (await page.getByTestId('next-block').boundingBox())!;
        const controls = (await page.getByTestId('controls').boundingBox())!;
        expect(controls.y).toBeGreaterThanOrEqual(next.y + next.height - 0.5);
        const mid = (b: typeof next) => b.x + b.width / 2;
        expect(Math.abs(mid(next) - mid(controls))).toBeLessThan(2);
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
  await page.getByRole('radio', { name: 'Hyperride' }).check({ force: true });
  // Without WebGL the screen falls back to Basic; the choice itself is applied either way.
  await expect(page.getByRole('radio', { name: 'Hyperride' })).toBeChecked();
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
  await expect(page.getByTestId('block-timer')).toContainText('block 1 of');
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
