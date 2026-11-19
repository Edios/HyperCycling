/**
 * Turns the last `npm run test:layout` run (test-results/layout/findings.jsonl) into a Markdown
 * report: violations merged across viewports, with severity, screenshot and a "being fixed" tag.
 *
 *   npm run layout:report [-- --out docs/superpowers/qa/findings.md --shots docs/superpowers/qa/shots]
 */
import fs from 'node:fs';
import path from 'node:path';

interface Violation {
  rule: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  target: string;
  rect?: { x: number; y: number; w: number; h: number };
}
interface Finding {
  scenario: string;
  state: string;
  viewport: string;
  size: string;
  variant: string;
  violations: Violation[];
  screenshot?: string;
}

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const OUT = arg('out', 'docs/superpowers/qa/findings.md');
const SHOTS = arg('shots', path.join(path.dirname(OUT), 'shots'));
const IN_DIR = path.resolve('test-results', 'layout');

/**
 * Areas that other sessions are fixing right now; a violation there is tagged so nobody files it
 * twice. Coarse on purpose (per scenario), re-check once those PRs are merged.
 */
const IN_REPAIR: { match: (f: Finding) => boolean; owner: string }[] = [
  {
    match: (f) => /^(training-|experience-)/.test(f.scenario),
    owner: 'w naprawie: training-hud-fixes',
  },
  { match: (f) => /^editor-music/.test(f.scenario), owner: 'w naprawie: editor-music-lane' },
];

const lines = fs
  .readFileSync(path.join(IN_DIR, 'findings.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Finding);

interface Group {
  key: string;
  scenario: string;
  states: Set<string>;
  rule: string;
  severity: Violation['severity'];
  message: string;
  target: string;
  cells: Set<string>;
  shot?: { file: string; cell: string };
  owner?: string;
}
const groups = new Map<string, Group>();
const SEV = { high: 0, medium: 1, low: 2 } as const;
for (const f of lines) {
  for (const v of f.violations) {
    // Numbers and quoted text differ per viewport and per row; the finding is the same.
    const base = (t: string): string => t.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N');
    const norm = base(v.message);
    const key = `${f.scenario}|${v.rule}|${norm}|${base(v.target)}`;
    const g =
      groups.get(key) ??
      ({
        key,
        scenario: f.scenario,
        states: new Set(),
        rule: v.rule,
        severity: v.severity,
        message: norm === v.message ? v.message : v.message,
        target: v.target,
        cells: new Set(),
        owner: IN_REPAIR.find((r) => r.match(f))?.owner,
      } satisfies Group);
    g.states.add(f.state);
    g.cells.add(`${f.viewport}${f.variant === 'pl-dark' ? '' : ` ${f.variant}`}`);
    if (!g.shot && f.screenshot) g.shot = { file: f.screenshot, cell: f.viewport };
    groups.set(key, g);
  }
}

const sorted = [...groups.values()].sort(
  (a, b) =>
    SEV[a.severity] - SEV[b.severity] ||
    a.scenario.localeCompare(b.scenario) ||
    b.cells.size - a.cells.size,
);

fs.mkdirSync(SHOTS, { recursive: true });
const copied = new Set<string>();
const shotRef = (g: Group): string => {
  if (!g.shot) return '';
  if (!copied.has(g.shot.file)) {
    const src = path.join(IN_DIR, 'shots', g.shot.file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(SHOTS, g.shot.file));
    copied.add(g.shot.file);
  }
  return `[${g.shot.cell}](shots/${g.shot.file})`;
};

const checked = lines.length;
const cellsRun = new Set(lines.map((f) => `${f.scenario}|${f.viewport}|${f.variant}`)).size;
const bySev = (s: string) => sorted.filter((g) => g.severity === s).length;
const today = new Date().toISOString().slice(0, 10);

const md: string[] = [];
md.push('# Findings: layout and visual QA (project `layout`)');
md.push('');
md.push(
  `Generated ${today} by \`npm run layout:report\` from ${checked} checked states in ${cellsRun} scenario/viewport/variant cells. ` +
    `${sorted.length} distinct findings: ${bySev('high')} high, ${bySev('medium')} medium, ${bySev('low')} low. ` +
    'Automatic heuristics: each row is a lead for a human, not a verdict (see ui-test-strategy.md, section 4).',
);
md.push('');
md.push(
  'Severity: **high** = the screen is hard or impossible to use (control off screen, covered or overlapping, required element missing); ',
);
md.push(
  '**medium** = text cut or overlapping, icon button not square; **low** = polish (touch target a little under 44 px, uneven icon sizes).',
);
md.push('');
md.push(
  '| # | Severity | Screen / state | Rule | What | Where (element) | Viewports | Screenshot | Status |',
);
md.push('|---|---|---|---|---|---|---|---|---|');
sorted.forEach((g, i) => {
  const cells = [...g.cells];
  const where =
    cells.length > 4 ? `${cells.slice(0, 4).join(', ')} +${cells.length - 4}` : cells.join(', ');
  const cell = (s: string): string => s.replace(/\|/g, '\\|');
  md.push(
    `| ${i + 1} | ${g.severity} | ${g.scenario} / ${[...g.states].join(', ')} | ${g.rule} | ${cell(g.message)} | ${cell(g.target)} | ${where} | ${shotRef(g)} | ${g.owner ?? 'nowe'} |`,
  );
});
md.push('');
md.push('## How to read this');
md.push('');
md.push(
  '- Status "nowe" = not covered by any session that is fixing layout now. Triage: confirm on a real phone, then report to the controller with the template from ui-test-strategy.md.',
);
md.push(
  '- Status "w naprawie: ..." = in an area (training HUD, editor music lane) that another session is changing; the tag is per screen, so re-run after those PRs merge and treat what remains as new.',
);
md.push(
  '- Screenshots are of the first viewport where the finding appeared; the column "Viewports" lists all.',
);
md.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md.join('\n'));
console.log(`wrote ${OUT}: ${sorted.length} findings (${copied.size} screenshots)`);
