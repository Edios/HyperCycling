import { test as base, expect } from '@playwright/test';

/**
 * The local project shares one database across tests. A stored interrupted session would pop the
 * resume prompt in the next test, so it is cleared before each test (the pages build has a fresh
 * IndexedDB per test context and needs nothing).
 */
export const test = base.extend<{ cleanActiveSession: void; advancedOpen: void }>({
  /**
   * The ride setup keeps "Advanced settings" closed until the rider opens it (and remembers that).
   * Most tests work with the options inside it, so they start with it open; the specs about the
   * closed layout reset the stored flag in their own init script (see setup-flow.spec.ts).
   */
  advancedOpen: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        try {
          if (localStorage.getItem('hypercycling.setup.advanced') === null) {
            localStorage.setItem('hypercycling.setup.advanced', '1');
          }
        } catch {
          // storage blocked: the accordion just starts closed
        }
      });
      await use();
    },
    { auto: true },
  ],
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
