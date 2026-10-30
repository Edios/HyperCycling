import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    {
      name: 'local',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5175' },
    },
    {
      name: 'pages',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5176/Spinning-Tutor/' },
    },
  ],
  webServer: [
    {
      command: 'npm start',
      url: 'http://127.0.0.1:5175/api/health',
      env: { NO_OPEN: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        'npm run build:pages && cross-env VITE_BASE=/Spinning-Tutor/ vite preview --outDir dist/pages --host 127.0.0.1 --port 5176 --strictPort',
      url: 'http://127.0.0.1:5176/Spinning-Tutor/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
