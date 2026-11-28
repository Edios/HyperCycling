import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import log from '../content/changelog/changelog.json';
import en from '../content/changelog/changelog.en.json';
import pl from '../content/changelog/changelog.pl.json';
import {
  buildChangelog,
  byDay,
  latestPr,
  needsText,
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

describe('titles a rider must not see as they are (review of #182)', () => {
  it('needs a hand-written text for review work, references, codes and Polish titles', () => {
    for (const t of [
      'Audit N-09 grouped list and the notes of #156',
      'Review nits of #145, #147',
      'Own songs nits 2',
      'Music audit P2-P5, P7: real cadence',
      'No silence inside a ride: gap rules R1-R4, Neon Grid fallback',
      'E4 world constructions for Neon Grid',
      'T5 audit, Deezer JSONP opt-in',
      'M24b-d mobile readability',
      'Poprawki po recenzji',
      'Experience w menu, czytelny scenariusz',
      'Kolejka utworów w slocie',
      'Hero B, podpis Experience, ikony SVG zamiast emoji',
      'Dopasuj utwory ze Spotify do podpowiedzi scenariusza',
      'Import playlisty, masowe tagowanie BPM i chipy Sugerowane',
      'Neon Grid 30 i Lekki 45, picker m:ss, powitanie 30 s',
    ]) {
      expect(needsText(t), t).toBe(true);
    }
    for (const t of [
      'Songs follow ramps and pyramids',
      'Own BPM window for 1:1, 2x and 4x',
      'VO2 max intervals in Freestyle',
      'FIT export of a recorded ride',
    ]) {
      expect(needsText(t), t).toBe(false);
    }
  });

  it('uses the hand-written text, hides an empty one, leaves out the rest', () => {
    const built = buildChangelog(
      [
        { number: 3, title: 'feat: audit N-09 grouped list', mergedAt: '2026-11-20T10:00:00Z' },
        { number: 2, title: 'fix: review nits of #1', mergedAt: '2026-11-20T10:00:00Z' },
        { number: 1, title: 'feat: task intro page', mergedAt: '2026-11-20T10:00:00Z' },
      ],
      '1.0.0',
      { '3': 'Workouts grouped into a clearer list.', '1': '' },
    );
    expect(built.entries).toEqual([
      { pr: 3, date: '2026-11-20', type: 'feat', title: 'Workouts grouped into a clearer list.' },
    ]);
  });

  it('ships no title a rider must not see without its hand-written text', () => {
    const texts = en as Record<string, string>;
    const raw = (log as Changelog).entries.filter(
      (e) => texts[String(e.pr)] === undefined && needsText(e.title),
    );
    expect(raw.map((e) => `#${e.pr} ${e.title}`)).toEqual([]);
    for (const e of (log as Changelog).entries) {
      if (texts[String(e.pr)] !== undefined) expect(e.title, `#${e.pr}`).toBe(texts[String(e.pr)]);
    }
  });
});
