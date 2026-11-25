import { describe, expect, it } from 'vitest';
import {
  parseShard,
  planShards,
  shardMatch,
  shardUnits,
  unitKey,
  weightsFromReports,
} from './e2e-shard-plan';

const weights = {
  'a.spec.ts|local': 5,
  'a.spec.ts|pages': 100,
  'b.spec.ts|local': 3,
  'b.spec.ts|pages': 60,
  'c.spec.ts|local': 1,
  'c.spec.ts|pages': 40,
  'd.spec.ts|local': 0,
  'd.spec.ts|pages': 30,
};
const files = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts'];
const projects = ['local', 'pages'];

describe('shardUnits', () => {
  it('has a unit for every file in every project, with its weight', () => {
    const units = shardUnits(files, projects, weights);
    expect(units).toHaveLength(8);
    expect(units.find((u) => u.file === 'a.spec.ts' && u.project === 'pages')?.weight).toBe(100);
    expect(units.find((u) => u.file === 'd.spec.ts' && u.project === 'local')?.weight).toBe(0);
  });

  it('gives a new spec without a weight the median one', () => {
    const units = shardUnits([...files, 'new.spec.ts'], projects, weights);
    const fresh = units.filter((u) => u.file === 'new.spec.ts').map((u) => u.weight);
    expect(fresh).toEqual([30, 30]);
  });
});

describe('planShards', () => {
  const units = shardUnits(files, projects, weights);

  it('gives every unit to exactly one shard', () => {
    const plan = planShards(units, 3);
    const keys = plan.flat().map((u) => unitKey(u.file, u.project));
    expect(keys.sort()).toEqual(units.map((u) => unitKey(u.file, u.project)).sort());
  });

  it('balances the weight: the heaviest shard is within one biggest unit of the lightest', () => {
    for (const total of [2, 3, 4]) {
      const loads = planShards(units, total).map((s) => s.reduce((n, u) => n + u.weight, 0));
      expect(Math.max(...loads) - Math.min(...loads), `${total} shards`).toBeLessThanOrEqual(100);
    }
    // 4 shards: the 100 s unit alone, the rest dealt around it.
    const four = planShards(units, 4).map((s) => s.reduce((n, u) => n + u.weight, 0));
    expect(four[0]).toBe(100);
    expect(Math.max(...four)).toBe(100);
  });

  it('is deterministic whatever the order of the units', () => {
    const reversed = [...units].reverse();
    expect(planShards(reversed, 3)).toEqual(planShards(units, 3));
  });

  it('rejects a bad total', () => {
    expect(() => planShards(units, 0)).toThrow(/Bad shard total/);
  });
});

describe('parseShard and shardMatch', () => {
  it('reads N/M', () => {
    expect(parseShard('2/4')).toEqual({ current: 2, total: 4 });
    for (const bad of ['', '0/4', '5/4', 'a/b', '2']) expect(() => parseShard(bad)).toThrow();
  });

  it('matches the files of one project in one shard, by file name only', () => {
    const plan = planShards(shardUnits(files, projects, weights), 2);
    const seen = new Set<string>();
    for (let current = 1; current <= 2; current++) {
      for (const project of projects) {
        const re = shardMatch(plan, current, project);
        for (const f of files) {
          if (re.test(`C:\\repo\\tests\\e2e\\${f}`) || re.test(`/repo/tests/e2e/${f}`)) {
            seen.add(`${f}|${project}|${current}`);
          }
        }
        expect(re.test('/repo/tests/e2e/xa.spec.ts')).toBe(false);
      }
    }
    // Every unit is matched in exactly one shard.
    expect(seen.size).toBe(8);
    expect(new Set([...seen].map((k) => k.split('|').slice(0, 2).join('|'))).size).toBe(8);
  });

  it('matches nothing for a project with no file in the shard', () => {
    const plan = [[{ file: 'a.spec.ts', project: 'pages', weight: 1 }], []];
    expect(shardMatch(plan, 2, 'pages').test('/x/a.spec.ts')).toBe(false);
    expect(shardMatch(plan, 1, 'local').test('/x/a.spec.ts')).toBe(false);
    expect(shardMatch(plan, 1, 'pages').test('/x/a.spec.ts')).toBe(true);
  });
});

describe('weightsFromReports', () => {
  it('sums the test time per file and project, in seconds, over all reports', () => {
    const report = (ms: number) => ({
      suites: [
        {
          specs: [
            { file: 'a.spec.ts', tests: [{ projectName: 'pages', results: [{ duration: ms }] }] },
            { file: 'a.spec.ts', tests: [{ projectName: 'local', results: [{ duration: 0 }] }] },
          ],
          suites: [
            {
              specs: [
                {
                  file: 'b.spec.ts',
                  tests: [
                    { projectName: 'pages', results: [{ duration: 1200 }, { duration: 800 }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(weightsFromReports([report(10_000), report(5_000)])).toEqual({
      'a.spec.ts|pages': 15,
      'a.spec.ts|local': 0,
      'b.spec.ts|pages': 4,
    });
  });
});
