import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import log from '../content/changelog/changelog.json';
import pl from '../content/changelog/changelog.pl.json';
import {
  buildChangelog,
  byDay,
  latestPr,
  parseTitle,
  polishDay,
  renderMarkdown,
  type Changelog,
} from './changelog';

describe('parseTitle', () => {
  it('reads the type, the scope and the text, capitalised', () => {
    expect(parseTitle('fix(plans): the plan wizard skips the FTP step')).toEqual({
      type: 'fix',
      scope: 'plans',
      title: 'The plan wizard skips the FTP step',
    });
    expect(parseTitle('feat: a thing')).toEqual({ type: 'feat', title: 'A thing' });
  });

  it('leaves out maintenance, CI, tests, docs and test tooling', () => {
    for (const t of [
      'chore(deps): bump',
      'ci: parallel jobs',
      'test(e2e): stabilise',
      'docs: rewrite README',
      'build: vite',
      'style: format',
      'fix(e2e): one server per worker',
    ]) {
      expect(parseTitle(t), t).toBeUndefined();
    }
  });

  it('drops internal codes in trailing parentheses, keeps real ones', () => {
    expect(parseTitle('feat(soundtrack): songs follow ramps (R1d-1)')?.title).toBe(
      'Songs follow ramps',
    );
    expect(parseTitle('feat(export): FIT export (E2a + E2b)')?.title).toBe('FIT export');
    expect(parseTitle('feat: wizard (Soundtrack Match PR 4)')?.title).toBe('Wizard');
    expect(parseTitle('feat: pause on a phone (R5.3, bug #17)')?.title).toBe('Pause on a phone');
    expect(parseTitle('feat: song finder (M19d, first slice)')?.title).toBe('Song finder');
    expect(parseTitle('feat: menus (A1-A3)')?.title).toBe('Menus');
    expect(parseTitle('feat: ERG (watts ring, ±5%)')?.title).toBe('ERG (watts ring, ±5%)');
  });

  it('keeps a title that is not a Conventional Commit as "other"', () => {
    expect(parseTitle('HyperCycling foundation')).toEqual({
      type: 'other',
      title: 'HyperCycling foundation',
    });
    expect(parseTitle('wip(x): something')?.type).toBe('other');
  });
});

describe('the changelog', () => {
  it('uses the Polish day (a late-evening merge is that day in Poland)', () => {
    expect(polishDay('2026-11-28T23:30:00Z')).toBe('2026-11-29');
    expect(polishDay('2026-07-01T21:59:00Z')).toBe('2026-07-01');
  });

  it('sorts newest first and groups by day', () => {
    const built = buildChangelog(
      [
        { number: 3, title: 'fix: c', mergedAt: '2026-11-20T10:00:00Z' },
        { number: 5, title: 'feat: e', mergedAt: '2026-11-21T10:00:00Z' },
        { number: 4, title: 'chore: d', mergedAt: '2026-11-21T11:00:00Z' },
        { number: 6, title: 'feat: f', mergedAt: '2026-11-21T09:00:00Z' },
      ],
      '9.9.9',
    );
    expect(built.version).toBe('9.9.9');
    expect(built.entries.map((e) => e.pr)).toEqual([6, 5, 3]);
    expect(byDay(built.entries).map((d) => [d.date, d.entries.length])).toEqual([
      ['2026-11-21', 2],
      ['2026-11-20', 1],
    ]);
    expect(latestPr(built)).toBe(6);
    expect(renderMarkdown(built, 'https://x')).toContain('- New: F ([#6](https://x/pull/6))');
  });

  it('ships a CHANGELOG.md that matches the JSON (run npm run changelog)', () => {
    const md = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
    expect(md.replace(/\r\n/g, '\n')).toBe(
      renderMarkdown(log as Changelog, 'https://github.com/Edios/HyperCycling'),
    );
  });

  it('has a Polish text only for changes in the list, never empty', () => {
    const prs = new Set((log as Changelog).entries.map((e) => String(e.pr)));
    for (const [pr, text] of Object.entries(pl as Record<string, string>)) {
      expect(prs.has(pr), pr).toBe(true);
      expect(text.trim().length, pr).toBeGreaterThan(10);
    }
  });
});
