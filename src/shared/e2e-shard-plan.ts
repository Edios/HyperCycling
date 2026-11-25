/**
 * Splits the Playwright specs over the CI shards by how long they take (not by test count).
 *
 * Playwright's own `--shard=N/M` cuts the ordered list of tests into chunks of equal COUNT, and the
 * order is project by project, so the two shards that got the `pages` project's World and layout
 * specs took 340-500 s while the first two took 60-130 s. Here every (spec file, project) pair is
 * a unit with a weight (seconds of test time, `tests/e2e/shard-weights.json`), and the units are
 * dealt out biggest first to the lightest shard. A spec that has no weight yet gets the median, so
 * a new file lands somewhere sensible until the weights are refreshed.
 *
 * Pure: no I/O. `playwright.config.ts` reads the files and the weights and calls this.
 */
export interface ShardUnit {
  file: string;
  project: string;
  /** Seconds of test time (all tests of the file in that project). */
  weight: number;
}

export type ShardWeights = Readonly<Record<string, number>>;

export const unitKey = (file: string, project: string): string => `${file}|${project}`;

/** The units of every file in every project; a file without a weight gets the median one. */
export function shardUnits(
  files: readonly string[],
  projects: readonly string[],
  weights: ShardWeights,
): ShardUnit[] {
  const known = Object.values(weights)
    .filter((w) => w > 0)
    .sort((a, b) => a - b);
  const median = known.length > 0 ? (known[Math.floor(known.length / 2)] as number) : 1;
  const units: ShardUnit[] = [];
  for (const file of files) {
    for (const project of projects) {
      units.push({ file, project, weight: weights[unitKey(file, project)] ?? median });
    }
  }
  return units;
}

/**
 * Deals the units out to `total` shards: biggest first, each to the shard with the least weight so
 * far (ties: the lower shard). Deterministic for the same units. Returns one list per shard.
 */
export function planShards(units: readonly ShardUnit[], total: number): ShardUnit[][] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`Bad shard total: ${total}`);
  const shards: ShardUnit[][] = Array.from({ length: total }, () => []);
  const load = new Array<number>(total).fill(0);
  const ordered = [...units].sort(
    (a, b) =>
      b.weight - a.weight || (unitKey(a.file, a.project) < unitKey(b.file, b.project) ? -1 : 1),
  );
  for (const u of ordered) {
    let at = 0;
    for (let i = 1; i < total; i++) if ((load[i] as number) < (load[at] as number)) at = i;
    (shards[at] as ShardUnit[]).push(u);
    load[at] = (load[at] as number) + u.weight;
  }
  return shards;
}

/** `"2/4"` -> shard 2 of 4 (1-based); anything else throws. */
export function parseShard(text: string): { current: number; total: number } {
  const m = /^(\d+)\/(\d+)$/.exec(text.trim());
  const current = m ? Number(m[1]) : 0;
  const total = m ? Number(m[2]) : 0;
  if (!m || current < 1 || total < 1 || current > total) throw new Error(`Bad shard "${text}"`);
  return { current, total };
}

/**
 * The `testMatch` of one project in one shard: the files the plan gives that shard for that project.
 * A project with no file in the shard matches nothing.
 */
export function shardMatch(plan: readonly ShardUnit[][], current: number, project: string): RegExp {
  const files = (plan[current - 1] ?? []).filter((u) => u.project === project).map((u) => u.file);
  if (files.length === 0) return /(?!)/;
  const escaped = files.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`[\\\\/](${escaped.join('|')})$`);
}

/** Per-unit seconds from Playwright JSON reports (`reporter: json`), summed over the reports. */
export function weightsFromReports(reports: readonly unknown[]): Record<string, number> {
  interface Suite {
    specs?: {
      file: string;
      tests?: { projectName: string; results?: { duration?: number }[] }[];
    }[];
    suites?: Suite[];
  }
  const ms: Record<string, number> = {};
  const visit = (s: Suite): void => {
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const key = unitKey(spec.file, t.projectName);
        const sum = (t.results ?? []).reduce((a, r) => a + (r.duration ?? 0), 0);
        ms[key] = (ms[key] ?? 0) + sum;
      }
    }
    for (const c of s.suites ?? []) visit(c);
  };
  for (const r of reports) for (const s of (r as { suites?: Suite[] }).suites ?? []) visit(s);
  const out: Record<string, number> = {};
  // Every unit is kept, also the 0 s of a spec that skips in a project: only a spec that is not in
  // the weights at all (a new file) gets the median.
  for (const [k, v] of Object.entries(ms)) out[k] = Math.round(v / 1000);
  return out;
}
