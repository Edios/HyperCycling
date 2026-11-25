#!/usr/bin/env node
// Refreshes tests/e2e/shard-weights.json from the Playwright JSON reports of a CI run (the
// `e2e-timing-N` artifacts, one per shard): seconds of test time per spec file and project.
//
//   gh run download <run-id> -p "e2e-timing-*" -D timing
//   node --import tsx scripts/e2e-shard-weights.mjs timing/*/results.json
//
// With no report it prints the plan the current weights give for 4 shards.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { planShards, shardUnits, weightsFromReports } from '../src/shared/e2e-shard-plan.ts';

const file = path.join('tests', 'e2e', 'shard-weights.json');
const reports = process.argv.slice(2);
if (reports.length > 0) {
  const weights = weightsFromReports(reports.map((r) => JSON.parse(readFileSync(r, 'utf8'))));
  const sorted = Object.fromEntries(Object.entries(weights).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(sorted).length} weights to ${file}.`);
}
const weights = JSON.parse(readFileSync(file, 'utf8'));
const specs = readdirSync(path.join('tests', 'e2e')).filter((f) => f.endsWith('.spec.ts'));
const plan = planShards(shardUnits(specs, ['local', 'pages'], weights), 4);
plan.forEach((units, i) => {
  const load = units.reduce((s, u) => s + u.weight, 0);
  console.log(`shard ${i + 1}/4: ${load} s of test time, ${units.length} units`);
});
