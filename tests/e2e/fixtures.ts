import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { assertSafeE2eDbPath } from '../../src/server/e2e-db-guard';

/** Asks the OS for a free TCP port (so parallel e2e runs on one machine never collide). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, isAlive: () => boolean): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error('The e2e server exited before it became healthy.');
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`The e2e server did not become healthy at ${url} within 60 s.`);
}

/** Same key as EDITOR_TOUR_KEY in the app. */
const EDITOR_TOUR_KEY = 'tour.editor.v1';

/**
 * The local project gives every worker its own server on its own port with its own throwaway
 * SQLite database. Settings, players and plan progress live in that database, so workers running
 * specs in parallel can no longer overwrite each other's state. (The pages build keeps its data in
 * IndexedDB, which is already separate for every test, and needs nothing.)
 */
export const test = base.extend<
  {
    cleanActiveSession: void;
    advancedOpen: void;
    editorTourSeen: boolean;
    seedEditorTour: void;
    meteredBike: boolean;
    seedMeteredBike: void;
  },
  { localServer: string | null }
>({
  localServer: [
    // Playwright requires the destructuring pattern for the (empty) fixture dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      if (!workerInfo.project.name.startsWith('local')) {
        await use(null);
        return;
      }
      const dir = mkdtempSync(
        path.join(tmpdir(), `spinning-tutor-e2e-w${workerInfo.workerIndex}-`),
      );
      const dbPath = assertSafeE2eDbPath(path.join(dir, 'e2e.db'));
      const port = await freePort();
      const url = `http://127.0.0.1:${port}`;
      // Run node directly (not through npm or scripts/start.ts) so the child's PID is the server's.
      const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
        stdio: 'ignore',
        env: {
          ...process.env,
          PORT: String(port),
          DB_PATH: dbPath,
          // The e2e client (with test fixtures) is built into dist/e2e by the global setup.
          STATIC_DIR: 'dist/e2e',
        },
      });
      let exited = false;
      const exit = new Promise<void>((resolve) => {
        server.once('exit', () => {
          exited = true;
          resolve();
        });
      });
      try {
        await waitForHealth(url, () => !exited);
        await use(url);
      } finally {
        if (!exited) server.kill();
        await Promise.race([exit, new Promise((r) => setTimeout(r, 5_000))]);
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // still locked by the server shutting down; the OS temp dir is cleaned eventually
        }
      }
    },
    { scope: 'worker' },
  ],

  baseURL: async ({ localServer, baseURL }, use) => {
    await use(localServer ?? baseURL);
  },

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
  /**
   * The editor tutorial opens by itself on the first visit, which would sit on top of every editor
   * test. It is marked as seen up front; a test of the first visit opts out with
   * `test.use({ editorTourSeen: false })`.
   */
  editorTourSeen: [true, { option: true }],
  /**
   * A fresh profile starts on a plain knob bike without watts. Most ride tests need watts and FTP,
   * so they start on a bike with a power meter; `test.use({ meteredBike: false })` keeps the
   * real default.
   */
  meteredBike: [true, { option: true }],
  seedMeteredBike: [
    async ({ context, meteredBike }, use) => {
      if (meteredBike) {
        await context.addInitScript(() => {
          try {
            localStorage.setItem('hypercycling.e2e.meteredBike', '1');
          } catch {
            // Storage unavailable: the plain default.
          }
        });
      }
      await use();
    },
    { auto: true },
  ],
  seedEditorTour: [
    async ({ context, editorTourSeen }, use) => {
      if (editorTourSeen) {
        await context.addInitScript((key) => {
          try {
            if (!localStorage.getItem(key)) {
              localStorage.setItem(key, JSON.stringify({ outcome: 'skipped' }));
            }
          } catch {
            // Storage unavailable: nothing to seed.
          }
        }, EDITOR_TOUR_KEY);
      }
      await use();
    },
    { auto: true },
  ],
  /**
   * What one test leaves in the worker's database must not reach the next one on that worker:
   * - a stored interrupted session would pop the resume prompt;
   * - stored settings win over the fresh-profile defaults, including the metered bike of
   *   `seedMeteredBike`: after any spec that saved a setting, a later ride test saw the plain knob
   *   bike (no watts) and failed, but only when both landed on the same worker (a flake that came
   *   and went with the sharding).
   * Both are cleared before each test (the pages build has a fresh IndexedDB per test context).
   */
  cleanActiveSession: [
    async ({ request }, use, info) => {
      if (info.project.name.startsWith('local')) {
        for (const url of ['/api/active-session', '/api/settings']) {
          const res = await request.delete(url);
          expect(res.ok(), url).toBe(true);
        }
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
