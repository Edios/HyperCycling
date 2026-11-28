import { expect, test } from './fixtures';

// Installable app (PWA): the manifest, the service worker and offline rides. Pages build only:
// the e2e build registers the service worker only when a test asks for it (localStorage flag),
// so the other specs keep Playwright's network mocks in front of the page.

test.beforeEach(({ browserName }, info) => {
  void browserName; // Playwright needs a destructured fixture argument
  test.skip(info.project.name !== 'pages', 'runs on the pages build only');
});

test('the manifest makes the app installable: standalone, colours, 192/512 and maskable icons', async ({
  page,
  request,
}) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await request.get(new URL(href!, page.url()).href);
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    display: string;
    start_url: string;
    scope: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest.display).toBe('standalone');
  // Relative: the same manifest works under any base path (GitHub Pages).
  expect(manifest.start_url).toBe('.');
  expect(manifest.scope).toBe('.');
  expect(manifest.theme_color).toBe('#070a12');
  expect(manifest.background_color).toBe('#070a12');
  const sizes = manifest.icons.map((i) => `${i.sizes}${i.purpose ? ` ${i.purpose}` : ''}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512 maskable']));
  for (const icon of manifest.icons) {
    const img = await request.get(new URL(icon.src, res.url()).href);
    expect(img.ok(), icon.src).toBe(true);
    expect(img.headers()['content-type']).toContain('image/png');
  }
});

test('the service worker installs, controls the page and keeps Freestyle and Experience working offline', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem('hypercycling.e2e.sw', '1'));
  await page.goto('./#/freestyle');
  await expect(page.getByTestId('workout-card').first()).toBeVisible();
  const scope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.scope;
  });
  expect(new URL(scope).pathname).toBe('/');
  // The first install takes over at once: after a reload the worker controls the page.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  // Nothing of the rider's data is in the cache: only the app's own files.
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys.find((k) => k.startsWith('hc-'))!);
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(cached).toContain('/index.html');
  expect(cached.some((p) => p.startsWith('/assets/'))).toBe(true);
  expect(cached.some((p) => p.startsWith('/api/') || p.startsWith('/docs/'))).toBe(false);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('workout-card').first()).toBeVisible();
  await page.goto('./#/experiences');
  await expect(page.getByTestId('experience-card').first()).toBeVisible();
  await page.goto('./#/plans');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await context.setOffline(false);
});

test('How it works explains installing the app', async ({ page }) => {
  await page.goto('./#/how-it-works');
  await expect(page.getByRole('heading', { name: 'Install as an app' })).toBeVisible();
});
