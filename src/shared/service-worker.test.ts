import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { publicShellFiles, serviceWorkerSource } from './service-worker';

describe('service worker', () => {
  const source = serviceWorkerSource(['index.html', 'assets/app-abc.js'], 'v123');

  it('is valid script with its version and precache list', () => {
    expect(() => new Script(source)).not.toThrow();
    expect(source).toContain("const CACHE = 'hc-v123';");
    expect(source).toContain('["index.html","assets/app-abc.js"]');
  });

  it('leaves other origins, the local data API, the help pages and the Deezer bridge alone', () => {
    // Only same-origin GET requests under the scope are answered; the rest goes to the network.
    expect(source).toContain("if (request.method !== 'GET') return;");
    expect(source).toContain('if (rel === null || BYPASS.test(rel)) return;');
    const bypass = /const BYPASS = (\/.*\/);/.exec(source)?.[1];
    const re = new Function(`return ${bypass}`)() as RegExp;
    for (const path of ['api/settings', 'docs/', 'deezer-bridge.html', 'deezer-bridge.js']) {
      expect(re.test(path), path).toBe(true);
    }
    for (const path of ['', 'index.html', 'assets/app-abc.js', 'fonts/Barlow-Regular.woff2']) {
      expect(re.test(path), path).toBe(false);
    }
  });

  it('never touches the rider data stores', () => {
    expect(source).not.toMatch(/indexedDB|localStorage/);
  });

  it('a new version waits for the page; only the first install takes over at once', () => {
    expect(source).toContain('self.registration.active ? undefined : self.skipWaiting()');
    expect(source).toContain("if (event.data === 'hc-skip-waiting') self.skipWaiting();");
  });

  it('precaches the shell from public/: fonts, icons, manifest; not the docs or the bridge', () => {
    const files = publicShellFiles('public');
    expect(files).toEqual(
      expect.arrayContaining([
        'index.html',
        'manifest.webmanifest',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'fonts/Barlow-Regular.woff2',
      ]),
    );
    expect(files.some((f) => f.startsWith('docs/') || f.startsWith('deezer-bridge'))).toBe(false);
  });
});
