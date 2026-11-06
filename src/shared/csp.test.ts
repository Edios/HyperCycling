import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES, PAGE_CSP } from './csp';
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
  'https://hypercycling.app', // Spotify redirect URI hint text
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
