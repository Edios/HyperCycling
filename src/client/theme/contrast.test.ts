import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// WCAG 1.4.3: every text token must reach 4.5:1 on every surface of its theme.
const css = readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]!] = m[2]!;
  return out;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const dark = block(':root');
const light = { ...dark, ...block("[data-theme='light']") };

describe.each([
  ['dark', dark],
  ['light', light],
] as const)('%s theme text contrast', (_name, tokens) => {
  for (const text of ['fg', 'mut', 'dim']) {
    for (const surface of ['bg', 's1', 's2']) {
      it(`--${text} on --${surface} is at least 4.5:1`, () => {
        expect(ratio(tokens[text]!, tokens[surface]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
