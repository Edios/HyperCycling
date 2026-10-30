import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The local project runs against its own server and a throwaway database, never the real data.
// Workers and globalTeardown inherit the env var, so the path is the same everywhere.
const E2E_PORT = 5185;
process.env.E2E_DB_PATH ??= path.join(tmpdir(), `spinning-tutor-e2e-${Date.now()}.db`);

export default defineConfig({
  testDir: 'tests/e2e',
  globalTeardown: './tests/e2e/global-teardown.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  projects: [
    {
      name: 'local',
      testIgnore: /(setup|training-basic)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${E2E_PORT}` },
    },
    {
      // Files that start a training session autosave it to the shared local database, which would
      // pop the resume prompt in tests running at the same time; so they run one file at a time.
      name: 'local-training',
      testMatch: /training-basic\.spec\.ts/,
      dependencies: ['local'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${E2E_PORT}` },
    },
    {
      // These tests keep a stored session around on purpose; running them after the other
      // local tests (which clear it before each test) keeps the shared database predictable.
      name: 'local-resume',
      testMatch: /setup\.spec\.ts/,
      dependencies: ['local-training'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${E2E_PORT}` },
    },
    {
      name: 'pages',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5176/Spinning-Tutor/' },
    },
  ],
  webServer: [
    {
      command: 'cross-env VITE_E2E=1 npm run build && npm start',
      url: `http://127.0.0.1:${E2E_PORT}/api/health`,
      env: { NO_OPEN: '1', PORT: String(E2E_PORT), DB_PATH: process.env.E2E_DB_PATH },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        'cross-env VITE_E2E=1 npm run build:pages && cross-env VITE_BASE=/Spinning-Tutor/ vite preview --outDir dist/pages --host 127.0.0.1 --port 5176 --strictPort',
      url: 'http://127.0.0.1:5176/Spinning-Tutor/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
