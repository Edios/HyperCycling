import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { pl } from './pl';

function flatten(obj: object, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v as object, key));
  }
  return out;
}

const placeholders = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('dictionaries', () => {
  const a = flatten(en);
  const b = flatten(pl);
  it('have no empty strings', () => {
    for (const [k, v] of Object.entries(a)) expect(v.trim(), `en ${k}`).not.toBe('');
    for (const [k, v] of Object.entries(b)) expect(v.trim(), `pl ${k}`).not.toBe('');
  });
  it('use the same {placeholders} in both languages', () => {
    for (const k of Object.keys(a)) expect(placeholders(b[k] ?? ''), k).toBe(placeholders(a[k]!));
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : [];
  });
}

/** Attributes whose string value a screen reader or the user can read. */
const READABLE_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'aria-description']);

describe('components', () => {
  it('contain no hard-coded UI text (words in JSX text or readable attributes)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.resolve(__dirname, '..'))) {
      const sf = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const report = (node: ts.Node, text: string): void => {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        offenders.push(`${path.relative(process.cwd(), file)}:${line + 1} ${JSON.stringify(text)}`);
      };
      const visit = (node: ts.Node): void => {
        // Glyph-only text (icons such as ⚙ or ×) has no letters and is fine.
        if (ts.isJsxText(node) && /\p{L}/u.test(node.text)) report(node, node.text.trim());
        if (
          ts.isJsxAttribute(node) &&
          READABLE_ATTRS.has(node.name.getText()) &&
          node.initializer &&
          ts.isStringLiteral(node.initializer) &&
          /\p{L}/u.test(node.initializer.text) &&
          !/^https?:\/\//.test(node.initializer.text)
        ) {
          report(node, node.initializer.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });
});
