import { defineConfig, devices } from '@playwright/test';

// Layout and visual QA project. Separate from playwright.config.ts on purpose: it never runs in
// `npm run test:e2e`, so it cannot block CI. It reports findings (test-results/layout/) and only
// fails in strict mode (LAYOUT_STRICT=1). It needs just the static Pages build, no server/database.
//
//   npm run test:layout            standard depth
//   LAYOUT_DEPTH=smoke npm run test:layout   core viewports only (fast)
//   LAYOUT_DEPTH=full npm run test:layout    every viewport and variant
//   npm run layout:report          writes docs/superpowers/qa/findings.md from the last run
const PORT = 5177;

export default defineConfig({
  testDir: 'tests/layout',
  outputDir: 'test-results/layout/artifacts',
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}/`,
    // The owner is startled by sudden sound: browsers in tests are always muted.
    launchOptions: { args: ['--mute-audio'] },
  },
  projects: [
    { name: 'layout-setup', testMatch: /setup\.spec\.ts/ },
    {
      name: 'layout',
      testMatch: /layout\.spec\.ts/,
      dependencies: ['layout-setup'],
    },
  ],
  webServer: {
    command:
      'npm run build:pages:e2e && cross-env VITE_BASE=/ vite preview --outDir dist/e2e-pages --host 127.0.0.1 --port 5177 --strictPort',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
