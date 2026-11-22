import { defineConfig, devices } from '@playwright/test';

// The local project has no baseURL here: tests/e2e/fixtures.ts starts one server per worker (own
// port, own throwaway SQLite database outside data/), so parallel specs never share state. Every
// spec must therefore import `test` from './fixtures', not from '@playwright/test'.
const browser = { ...devices['Desktop Chrome'], launchOptions: { args: ['--mute-audio'] } };

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
    { name: 'local', use: browser },
    { name: 'pages', use: { ...browser, baseURL: 'http://127.0.0.1:5176/' } },
  ],
  webServer: {
    command:
      'npm run build:pages:e2e && cross-env VITE_BASE=/ vite preview --outDir dist/e2e-pages --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
