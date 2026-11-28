/**
 * The changelog: built from the titles of merged pull requests (Conventional Commits, English) by
 * `npm run changelog` (scripts/changelog.ts), shown in the app under "What's new" and written to
 * CHANGELOG.md. Polish texts are written by hand (`changelog.pl.json`), only for recent changes.
 *
 * Pure functions only: the script does the I/O, the app and the tests read the committed JSON.
 */

/** Kinds of change a rider sees. Everything else (chore, ci, test, docs, build, style) is left out. */
export const CHANGE_TYPES = ['feat', 'fix', 'perf', 'refactor', 'other'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

/** Conventional Commit types that never reach the changelog: work on the repo, not on the app. */
export const SKIPPED_TYPES: readonly string[] = ['chore', 'ci', 'test', 'docs', 'build', 'style'];
/** Scopes of the test and build tooling: left out whatever the type (e.g. `fix(e2e)`). */
export const SKIPPED_SCOPES: readonly string[] = ['e2e', 'ci', 'deps', 'layout'];

export interface ChangelogEntry {
  /** Pull request number (unique). */
  pr: number;
  /** Day the pull request was merged, in Poland (YYYY-MM-DD). */
  date: string;
  type: ChangeType;
  scope?: string;
  /** The title without its type, scope and internal codes, starting with a capital letter. */
  title: string;
}

export interface Changelog {
  v: 1;
  /** The app's version (package.json) when the file was generated. */
  version: string;
  /** Newest first. */
  entries: ChangelogEntry[];
}

/** A merged pull request as `gh pr list --state merged --json number,title,mergedAt` gives it. */
export interface MergedPr {
  number: number;
  title: string;
  mergedAt: string;
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/**
 * Internal codes at the end of a title, in parentheses: plan steps (R1e-2, T5b, M19b, A1-A3,
 * E2a + E2b), the Soundtrack Match PR number, redesign steps, review references. They mean nothing
 * to a rider. A parenthesis goes only when every comma- or plus-separated part is such a code.
 */
const CODE_TOKEN =
  /^(?:[A-Z]{1,2}\d+[\w.]*(?:-[A-Z]?\d+\w*)?(?:\s+(?:rest|part \d+|first slice))?|bug #\d+|stacked on #\d+|#\d+-\d+(?:\.\.\d+)?|Soundtrack Match PR \w+|PR \d+\w*|redesign step \d+|spec [\w\s]+|pkt [\w\s]+|[\w-]+\.spec\.ts:\d+)$/i;
const TRAILING_PARENS = /\s*\(([^()]*)\)\s*$/;

function stripCodes(text: string): string {
  let out = text;
  for (;;) {
    const m = TRAILING_PARENS.exec(out);
    if (!m) return out;
    const parts = m[1]!.split(/[,+]/).map((p) => p.trim());
    if (!parts.every((p) => CODE_TOKEN.test(p))) return out;
    out = out.slice(0, m.index);
  }
}

/** One title -> its type, scope and text; undefined when it is left out of the changelog. */
export function parseTitle(
  title: string,
): { type: ChangeType; scope?: string; title: string } | undefined {
  const m = CONVENTIONAL.exec(title.trim());
  let type = 'other';
  let scope: string | undefined;
  let text = title.trim();
  if (m) {
    type = m[1]!.toLowerCase();
    scope = m[2]?.trim() || undefined;
    text = m[4]!;
  }
  if (SKIPPED_TYPES.includes(type)) return undefined;
  if (scope && SKIPPED_SCOPES.includes(scope.toLowerCase())) return undefined;
  if (!(CHANGE_TYPES as readonly string[]).includes(type)) type = 'other';
  let clean = stripCodes(text).trim();
  if (clean === '') return undefined;
  clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  return { type: type as ChangeType, ...(scope ? { scope } : {}), title: clean };
}

/** The day of an ISO timestamp in Poland (the owner's and the riders' day), YYYY-MM-DD. */
export function polishDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Merged pull requests -> the changelog (newest first, skipped types left out). */
export function buildChangelog(prs: readonly MergedPr[], version: string): Changelog {
  const entries: ChangelogEntry[] = [];
  for (const pr of prs) {
    const parsed = parseTitle(pr.title);
    if (!parsed) continue;
    entries.push({ pr: pr.number, date: polishDay(pr.mergedAt), ...parsed });
  }
  entries.sort((a, b) => (a.date === b.date ? b.pr - a.pr : a.date < b.date ? 1 : -1));
  return { v: 1, version, entries };
}

/** Entries grouped by day, newest day first (the order of `entries` is kept inside a day). */
export function byDay(
  entries: readonly ChangelogEntry[],
): { date: string; entries: ChangelogEntry[] }[] {
  const out: { date: string; entries: ChangelogEntry[] }[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last.date === e.date) last.entries.push(e);
    else out.push({ date: e.date, entries: [e] });
  }
  return out;
}

const TYPE_LABEL: Record<ChangeType, string> = {
  feat: 'New',
  fix: 'Fixed',
  perf: 'Faster',
  refactor: 'Improved',
  other: 'Changed',
};

/** CHANGELOG.md, from the same data the app shows. */
export function renderMarkdown(log: Changelog, repoUrl: string): string {
  const lines = [
    '# Changelog',
    '',
    'What changed in HyperCycling, newest first. Generated by `npm run changelog` from the titles of',
    'merged pull requests (maintenance, CI, tests and docs are left out). The app shows the same list',
    'under "What\'s new" (Polish texts for recent changes are written by hand).',
    '',
    `## ${log.version}`,
  ];
  for (const day of byDay(log.entries)) {
    lines.push('', `### ${day.date}`, '');
    for (const e of day.entries) {
      const scope = e.scope ? `**${e.scope}:** ` : '';
      lines.push(
        `- ${TYPE_LABEL[e.type]}: ${scope}${e.title} ([#${e.pr}](${repoUrl}/pull/${e.pr}))`,
      );
    }
  }
  return lines.join('\n') + '\n';
}

/** Newest pull request number in the changelog: what "seen" remembers for the new-items dot. */
export function latestPr(log: Changelog): number {
  return log.entries.reduce((max, e) => Math.max(max, e.pr), 0);
}
