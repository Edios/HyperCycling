import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['src/client/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/client/test-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/client/**'],
        },
      },
    ],
  },
});
