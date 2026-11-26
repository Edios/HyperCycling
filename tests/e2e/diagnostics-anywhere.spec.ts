import { expect, test } from './fixtures';

// Diagnostics mode from anywhere: ?diag, Ctrl+Shift+D and five taps on the logo switch the
// global overlay, which stays up during a ride and copies one masked report. The switch is
// stored in this worker's database, so the test turns it off again whatever happens.

test('diagnostics anywhere: ?diag, shortcut, logo taps, overlay in a ride, copy report', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'local', 'the dev menu is in the local build');
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(baseURL ?? page.url()).origin,
  });
  const overlay = page.getByTestId('diagnostics-overlay');
  try {
    // ?diag switches it on, on an ordinary screen.
    await page.goto('./?diag#/plan');
    await expect(overlay).toBeVisible();
    await expect(page.getByTestId('diagnostics-viewport')).toContainText(/\d+x\d+@.* dvh\d+/);
    await expect(page.getByTestId('diagnostics-bt')).toContainText('trainer none');

    // The shortcut turns it off and on again.
    await page.keyboard.press('Control+Shift+KeyD');
    await expect(overlay).toHaveCount(0);
    await page.keyboard.press('Control+Shift+KeyD');
    await expect(overlay).toBeVisible();

    // Five quick taps on the logo turn it off (the phone gesture).
    const logo = page.getByTestId('app-logo');
    for (let i = 0; i < 5; i++) await logo.click();
    await expect(overlay).toHaveCount(0);
    for (let i = 0; i < 5; i++) await logo.click();
    await expect(overlay).toBeVisible();

    // It stays up in a ride and names the scene drawn behind the HUD.
    await page.goto('./?dev#/dev');
    const row = page.getByTestId('workout-row').filter({ hasText: 'Demo mix' });
    await row.getByRole('button', { name: 'Ride', exact: true }).click();
    await expect(page.getByTestId('training-screen')).toBeVisible();
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(/FPS \d+/);

    // One report with sections, copied from the overlay's menu.
    await page.getByTestId('diagnostics-menu').click();
    await page.getByTestId('diagnostics-copy').click();
    await expect(page.getByText('Report copied')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    for (const part of [
      'HyperCycling diagnostics report',
      'Screen: #/train',
      '== Viewport ==',
      '== Settings (no secrets) ==',
      '== Bluetooth ==',
      '== Errors and warnings ==',
    ]) {
      expect(copied).toContain(part);
    }
    expect(errors).toEqual([]);
  } finally {
    await page.goto('./?diag=0#/');
    await expect(overlay).toHaveCount(0);
  }
});
