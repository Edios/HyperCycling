import { createContext, Script } from 'node:vm';
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

  describe('fetch handler', () => {
    type Handler = (event: { request: Req; respondWith: (p: Promise<unknown>) => void }) => void;
    interface Req {
      url: string;
      method: string;
      mode: string;
    }
    /** Runs the generated worker with fake caches and fetch; returns its fetch handler. */
    function load(online: boolean) {
      const matches: { url: string; options: unknown }[] = [];
      const fetched: string[] = [];
      const handlers: Record<string, Handler> = {};
      const cached = { url: 'cached' };
      const sandbox = {
        URL,
        Response: { error: () => ({ url: 'error' }) },
        self: {
          location: { origin: 'https://hypercycling.app' },
          registration: { scope: 'https://hypercycling.app/' },
          addEventListener: (type: string, h: Handler) => (handlers[type] = h),
        },
        caches: {
          match: (r: Req | string, options: unknown) => {
            matches.push({ url: typeof r === 'string' ? r : r.url, options });
            return Promise.resolve(cached);
          },
          open: () => Promise.resolve({ put: () => Promise.resolve() }),
        },
        fetch: (r: Req) => {
          fetched.push(r.url);
          return online
            ? Promise.resolve({ ok: true, type: 'basic', url: 'network', clone: () => ({}) })
            : Promise.reject(new Error('offline'));
        },
      };
      new Script(source).runInContext(createContext(sandbox));
      const run = async (path: string, mode = 'no-cors'): Promise<unknown> => {
        let out: Promise<unknown> | undefined;
        handlers.fetch!({
          request: { url: `https://hypercycling.app/${path}`, method: 'GET', mode },
          respondWith: (p) => (out = p),
        });
        return out;
      };
      return { run, matches, fetched };
    }

    it('hashed files come from the cache first, matched with ignoreVary', async () => {
      const w = load(true);
      expect(await w.run('assets/app-abc.js', 'cors')).toEqual({ url: 'cached' });
      expect(w.fetched).toEqual([]);
      expect(w.matches[0]?.options).toEqual({ ignoreVary: true });
    });

    it('public files without a hash follow the network while online', async () => {
      const w = load(true);
      expect(await w.run('intro-boot.js')).toMatchObject({ url: 'network' });
      expect(w.matches).toEqual([]);
    });

    it('offline, public files and pages fall back to the cache, ignoring Vary', async () => {
      const w = load(false);
      expect(await w.run('fonts/Barlow-Regular.woff2', 'cors')).toEqual({ url: 'cached' });
      expect(await w.run('', 'navigate')).toEqual({ url: 'cached' });
      expect(w.matches.map((m) => m.options)).toEqual([{ ignoreVary: true }, { ignoreVary: true }]);
      expect(w.matches[1]?.url).toBe('https://hypercycling.app/index.html');
    });
  });
});
