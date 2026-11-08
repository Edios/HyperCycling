import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRIDGE_CSP, BRIDGE_CSP_DIRECTIVES, CSP_DIRECTIVES, PAGE_CSP, SERVER_CSP } from './csp';
import { injectCspMeta } from './cspMeta';

const root = path.resolve(__dirname, '..', '..');

describe('injectCspMeta', () => {
  it('puts the meta in the real index.html before any script or stylesheet', () => {
    const out = injectCspMeta(
      readFileSync(path.join(root, 'index.html'), 'utf8') +
        '<script type="module" src="/x.js"></script><link rel="stylesheet" href="/x.css">',
    );
    const meta = out.indexOf('http-equiv="Content-Security-Policy"');
    expect(meta).toBeGreaterThan(-1);
    expect(out).toContain(PAGE_CSP);
    expect(PAGE_CSP).not.toContain('frame-ancestors');
    expect(meta).toBeLessThan(out.indexOf('<script'));
    expect(meta).toBeLessThan(out.indexOf('<link')); // first link: icon, then stylesheet
    expect(out.indexOf('<meta charset')).toBeLessThan(meta);
  });

  it('throws instead of silently shipping without a CSP', () => {
    expect(() => injectCspMeta('<html><head></head></html>')).toThrow(/CSP meta/);
  });
});

/** Documentation-only or navigation-only URLs: never fetched, framed or loaded as script. */
const NOT_FETCHED = new Set([
  'https://youtu.be', // link shown to the user
  'https://getsongbpm.com', // attribution link and song links shown to the user
  'https://hypercycling.app', // Spotify redirect URI hint text
  'https://getsongbpm.com', // attribution link in the Home footer (navigation only)
  'https://developers.deezer.com', // API docs link in a code comment
  'https://www.deezer.com', // attribution link and track links shown to the user
  'https://api.deezer.com', // loaded only by the sandboxed bridge page (see the bridge tests)
  'https://github.com', // project link in the Home footer (navigation only)
  'https://edios.github.io', // old Pages address, kept in the redirect URI hint
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('CSP covers every origin the app code uses', () => {
  const allowed = new Set(
    ['connect-src', 'script-src', 'frame-src'].flatMap((d) => CSP_DIRECTIVES[d] ?? []),
  );
  const used = new Map<string, string>();
  for (const file of sourceFiles(path.join(root, 'src'))) {
    if (file.endsWith(path.join('shared', 'csp.ts'))) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      used.set(m[0].toLowerCase(), path.relative(root, file));
    }
  }

  it('finds the known origins (the scan itself works)', () => {
    expect(used.has('https://api.spotify.com')).toBe(true);
    expect(used.has('https://www.youtube.com')).toBe(true);
  });

  it.each([...used])('%s (%s) is allowed or documentation-only', (origin) => {
    expect(allowed.has(origin) || NOT_FETCHED.has(origin), origin).toBe(true);
  });
});

describe('Deezer JSONP is kept out of the page origin', () => {
  it('lists api.deezer.com nowhere in the page or server policy', () => {
    for (const csp of [PAGE_CSP, SERVER_CSP]) expect(csp).not.toContain('deezer');
  });

  it('only lets the page frame itself, YouTube and nothing else', () => {
    expect(CSP_DIRECTIVES['frame-src']).toEqual([
      "'self'",
      'https://www.youtube.com',
      'https://www.youtube-nocookie.com',
    ]);
  });

  it('gives the bridge page a policy with api.deezer.com as the only foreign script host', () => {
    expect(BRIDGE_CSP_DIRECTIVES['default-src']).toEqual(["'none'"]);
    expect(BRIDGE_CSP_DIRECTIVES['script-src']).toEqual(["'self'", 'https://api.deezer.com']);
    expect(Object.keys(BRIDGE_CSP_DIRECTIVES)).not.toContain('connect-src');
  });

  it('ships a bridge page whose own <meta> policy equals BRIDGE_CSP, and a strict script', () => {
    const html = readFileSync(path.join(root, 'public', 'deezer-bridge.html'), 'utf8');
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
    expect(meta?.[1]).toBe(BRIDGE_CSP);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/); // no inline script
    const js = readFileSync(path.join(root, 'public', 'deezer-bridge.js'), 'utf8');
    expect(js).toContain("'https://api.deezer.com/'");
    expect(js).toContain('event.source !== parent');
    expect(js).not.toMatch(/\beval\b|new Function|innerHTML|localStorage|document\.cookie/);
  });

  it('lets the music check and the failover reach YouTube: oEmbed, the IFrame API and both player hosts', () => {
    expect(CSP_DIRECTIVES['connect-src']).toContain('https://www.youtube.com'); // oEmbed
    expect(CSP_DIRECTIVES['script-src']).toEqual(
      expect.arrayContaining(['https://www.youtube.com', 'https://s.ytimg.com']),
    );
    expect(CSP_DIRECTIVES['frame-src']).toEqual(
      expect.arrayContaining(['https://www.youtube.com', 'https://www.youtube-nocookie.com']),
    );
    expect(PAGE_CSP).toContain('frame-src');
    expect(SERVER_CSP).toContain('https://www.youtube-nocookie.com');
  });
});
