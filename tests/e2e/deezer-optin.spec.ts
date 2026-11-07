import { expect, test } from './fixtures';

// Deezer JSONP is opt-in and isolated (T5). Pages build only (own IndexedDB per test). The real
// api.deezer.com is never called: its answer is a route mock that returns JSONP.

test('the page policy has no Deezer, and the lookup is off until the rider turns it on', async ({
  page,
}) => {
  const deezer: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith('https://api.deezer.com')) deezer.push(r.url());
  });
  await page.goto('./#/settings');
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).not.toContain('deezer');
  await expect(page.locator('iframe[title="Deezer bridge"]')).toHaveCount(0);

  const toggle = page.getByRole('switch', { name: /Deezer tempo lookup/ });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('deezer-lookup-hint')).toContainText(
    'Loads a script from api.deezer.com; off by default',
  );
  expect(deezer).toEqual([]);
});

test('the sandboxed bridge answers JSONP and cannot reach the app origin', async ({ page }) => {
  await page.route('https://api.deezer.com/**', (route) => {
    const callback = new URL(route.request().url()).searchParams.get('callback') ?? '';
    return route.fulfill({
      contentType: 'text/javascript',
      body: `${callback}({"data":[{"id":1,"title":"Song","artist":{"name":"Band"}}]});`,
    });
  });
  await page.goto('./#/settings');
  const result = await page.evaluate(
    () =>
      new Promise<{ ok: boolean; data: unknown; sandboxed: boolean }>((resolve) => {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.hidden = true;
        frame.src = '/deezer-bridge.html';
        window.addEventListener('message', (e) => {
          if (e.source !== frame.contentWindow) return;
          const m = e.data as { type: string; id?: number; ok?: boolean; data?: unknown };
          if (m.type === 'hc-ready') {
            const name = '__hcDeezere2e1';
            frame.contentWindow?.postMessage(
              {
                type: 'hc-jsonp',
                id: 1,
                name,
                url: `https://api.deezer.com/search?q=x&output=jsonp&callback=${name}`,
              },
              '*',
            );
          } else if (m.type === 'hc-jsonp-result') {
            resolve({ ok: m.ok === true, data: m.data, sandboxed: e.origin === 'null' });
          }
        });
        document.body.appendChild(frame);
      }),
  );
  expect(result.ok).toBe(true);
  expect(result.sandboxed).toBe(true); // opaque origin: no access to our storage or tokens
  expect(result.data).toEqual({ data: [{ id: 1, title: 'Song', artist: { name: 'Band' } }] });
});

test('the bridge refuses a URL outside api.deezer.com', async ({ page }) => {
  await page.goto('./#/settings');
  const ok = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.hidden = true;
        frame.src = '/deezer-bridge.html';
        window.addEventListener('message', (e) => {
          if (e.source !== frame.contentWindow) return;
          const m = e.data as { type: string; ok?: boolean };
          if (m.type === 'hc-ready') {
            frame.contentWindow?.postMessage(
              {
                type: 'hc-jsonp',
                id: 2,
                name: '__hcDeezerevil',
                url: 'https://evil.example/x.js?callback=__hcDeezerevil',
              },
              '*',
            );
          } else if (m.type === 'hc-jsonp-result') resolve(m.ok === true);
        });
        document.body.appendChild(frame);
      }),
  );
  expect(ok).toBe(false);
});
