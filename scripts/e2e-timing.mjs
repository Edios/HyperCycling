#!/usr/bin/env node
// Summarizes a Playwright JSON report (reporter `json`): time per spec file and project, the
// slowest first, plus flaky and failed counts. Written to the GitHub job summary when there is
// one, else to the terminal.
//
//   node scripts/e2e-timing.mjs [report.json] [label]
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'test-results/results.json';
const label = process.argv[3] ?? '';
if (!existsSync(file)) {
  console.log(`No ${file}: nothing to summarize.`);
  process.exit(0);
}

const report = JSON.parse(readFileSync(file, 'utf8'));
const perFile = new Map();
const counts = { tests: 0, flaky: 0, failed: 0, skipped: 0 };

function visit(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      counts.tests += 1;
      if (test.status === 'flaky') counts.flaky += 1;
      else if (test.status === 'unexpected') counts.failed += 1;
      else if (test.status === 'skipped') counts.skipped += 1;
      const key = `${spec.file} [${test.projectName}]`;
      const ms = (test.results ?? []).reduce((sum, r) => sum + (r.duration ?? 0), 0);
      const row = perFile.get(key) ?? { ms: 0, tests: 0 };
      row.ms += ms;
      row.tests += 1;
      perFile.set(key, row);
    }
  }
  for (const child of suite.suites ?? []) visit(child);
}
for (const suite of report.suites ?? []) visit(suite);

const rows = [...perFile.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 10);
const wallSec = Math.round((report.stats?.duration ?? 0) / 1000);
const lines = [
  `### e2e ${label}`.trim(),
  '',
  `${counts.tests} tests (${counts.skipped} skipped, ${counts.flaky} flaky, ${counts.failed} failed), wall ${wallSec} s.`,
  '',
  '| Spec [project] | Tests | Worker time (s) |',
  '|---|---:|---:|',
  ...rows.map(([key, row]) => `| ${key} | ${row.tests} | ${Math.round(row.ms / 1000)} |`),
  '',
];
const text = lines.join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
else console.log(text);
