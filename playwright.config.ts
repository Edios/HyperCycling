import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { parseShard, planShards, shardMatch, shardUnits } from './src/shared/e2e-shard-plan';

// The local project has no baseURL here: tests/e2e/fixtures.ts starts one server per worker (own
// port, own throwaway SQLite database outside data/), so parallel specs never share state. Every
// spec must therefore import `test` from './fixtures', not from '@playwright/test'.
const browser = { ...devices['Desktop Chrome'], launchOptions: { args: ['--mute-audio'] } };

// CI runs one shard per job: `E2E_SHARD=2/4`. The specs are dealt out by their measured time
// (tests/e2e/shard-weights.json, refreshed with scripts/e2e-shard-weights.mjs), which Playwright's own
// `--shard` cannot do: it cuts by test count, and the slow `pages` specs all fell into two shards.
// Without E2E_SHARD every spec runs.
const PROJECTS = ['local', 'pages'];
const shard = process.env.E2E_SHARD ? parseShard(process.env.E2E_SHARD) : undefined;
const plan = shard
  ? planShards(
      shardUnits(
        readdirSync('tests/e2e').filter((f) => f.endsWith('.spec.ts')),
        PROJECTS,
        JSON.parse(readFileSync('tests/e2e/shard-weights.json', 'utf8')) as Record<string, number>,
      ),
      shard.total,
    )
  : undefined;
const only = (project: string) =>
  plan && shard ? { testMatch: shardMatch(plan, shard.current, project) } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // On CI the json report feeds scripts/e2e-timing.mjs (slowest specs, per shard).
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['json', { outputFile: 'test-results/results.json' }],
      ]
    : 'list',
  projects: [
    { name: 'local', use: browser, ...only('local') },
    { name: 'pages', use: { ...browser, baseURL: 'http://127.0.0.1:5176/' }, ...only('pages') },
  ],
  webServer: {
    command:
      'npm run build:pages:e2e && cross-env VITE_BASE=/ vite preview --outDir dist/e2e-pages --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
