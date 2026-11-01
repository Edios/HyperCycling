import { test as base, expect } from '@playwright/test';

/**
 * The local project shares one database across tests. A stored interrupted session would pop the
 * resume prompt in the next test, so it is cleared before each test (the pages build has a fresh
 * IndexedDB per test context and needs nothing).
 */
export const test = base.extend<{ cleanActiveSession: void }>({
  cleanActiveSession: [
    async ({ request }, use, info) => {
      if (info.project.name.startsWith('local')) {
        const res = await request.delete('/api/active-session');
        expect(res.ok()).toBe(true);
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
