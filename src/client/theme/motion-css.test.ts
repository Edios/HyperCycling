import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith('.css') ? [p] : [];
  });
}
const tokens = readFileSync(join(__dirname, 'tokens.css'), 'utf8');

describe('motion CSS', () => {
  it('every animation name has a @keyframes in the same file (CSS Modules localise names)', () => {
    const bad: string[] = [];
    for (const f of cssFiles(ROOT)) {
      const src = readFileSync(f, 'utf8');
      const local = new Set([...src.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
      for (const m of src.matchAll(/(?<![-\w])animation(?:-name)?\s*:\s*([^;]+);/g)) {
        const first = m[1]!.trim().split(/\s+/);
        if (first[0] === 'none') continue;

        const name = first.find((w) => local.has(w)) ?? first[0]!;
        const ok = local.has(name);
        if (!ok) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('motion tokens exist and are zeroed with reduced motion', () => {
    expect(tokens).toMatch(/--motion-menu:\s*110ms/);
    expect(tokens).toMatch(/--motion-panel:\s*160ms/);
    expect(tokens).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{\s*--motion-menu:\s*0ms;\s*--motion-panel:\s*0ms/,
    );
  });
});
