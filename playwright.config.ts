import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { assertSafeE2eDbPath } from './src/server/e2e-db-guard';

// The local project runs against its own server and a throwaway database, never the real data.
// Workers and globalTeardown inherit the env var, so the path is the same everywhere.
const E2E_PORT = 5185;
process.env.E2E_DB_PATH ??= path.join(tmpdir(), `spinning-tutor-e2e-${Date.now()}.db`);
// Refuse an explicit E2E_DB_PATH that points into the real data/ directory.
assertSafeE2eDbPath(process.env.E2E_DB_PATH);

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
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5176/HyperCycling/' },
    },
  ],
  webServer: [
    {
      command: 'npm run build:e2e && npm start',
      url: `http://127.0.0.1:${E2E_PORT}/api/health`,
      env: {
        NO_OPEN: '1',
        PORT: String(E2E_PORT),
        DB_PATH: process.env.E2E_DB_PATH,
        // The e2e client (with test fixtures) lives apart from the normal dist/client build.
        STATIC_DIR: 'dist/e2e',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        'npm run build:pages:e2e && cross-env VITE_BASE=/HyperCycling/ vite preview --outDir dist/e2e-pages --host 127.0.0.1 --port 5176 --strictPort',
      url: 'http://127.0.0.1:5176/HyperCycling/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
