import { expect, test } from './fixtures';

// The shared local database would keep the diagnostics switch for later tests; the pages build
// has a fresh IndexedDB per test, so this flow runs there only.
test('diagnostics: device card, performance test table and copy report', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'pages', 'diagnostics flow runs on the Pages build');
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(baseURL ?? 'http://127.0.0.1:5176').origin,
  });

  // `diagMs` shortens each of the four steps; it is honoured in e2e builds only.
  await page.goto('./#/settings?diagMs=600');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await nav.getByRole('button', { name: 'Diagnostics' }).click();

  const toggle = page.getByRole('switch', { name: 'Diagnostics mode' });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('device-card')).toHaveCount(0);
  await toggle.check({ force: true });
  const card = page.getByTestId('device-card');
  await expect(card).toBeVisible();
  await expect(card.getByText('CPU threads')).toBeVisible();
  await expect(card.getByText('WebGL 2')).toBeVisible();

  await page.goto('about:blank');
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  });
  test.skip(!webgl, 'WebGL is not available in this headless browser');

  await page.goto('./#/settings?diagMs=600');
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByRole('dialog', { name: 'Performance test' })).toBeVisible();
  const table = page.getByTestId('results-table');
  await expect(table).toBeVisible({ timeout: 45_000 });
  await expect(table.getByRole('row')).toHaveCount(7); // header + 6 combinations (Road x4 + Scenes x2)
  await expect(
    page.getByRole('status').filter({ hasText: /Recommended quality|Basic/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Copy report' }).click();
  await expect(page.getByText('Report copied')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Spinning Tutor diagnostics report');
  expect(copied).toContain('neon-tunnel / high');
  expect(errors).toEqual([]);
});
