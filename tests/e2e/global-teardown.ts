import { rmSync } from 'node:fs';

/** Removes the throwaway database (and SQLite side files) the local e2e server used. */
export default function globalTeardown(): void {
  const db = process.env.E2E_DB_PATH;
  if (!db) return;
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      rmSync(db + suffix, { force: true });
    } catch {
      // still locked by the server shutting down; the OS temp dir is cleaned eventually
    }
  }
}
