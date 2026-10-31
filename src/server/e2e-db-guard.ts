import path from 'node:path';

/**
 * The e2e run must only ever write to a throwaway database. Throws when `dbPath` resolves to
 * anywhere inside the real `data/` directory (the player's database and backups live there).
 */
export function assertSafeE2eDbPath(dbPath: string, repoRoot: string = process.cwd()): string {
  const resolved = path.resolve(repoRoot, dbPath);
  const dataDir = path.resolve(repoRoot, 'data');
  const rel = path.relative(dataDir, resolved);
  const insideData = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (insideData) {
    throw new Error(
      `E2E_DB_PATH (${resolved}) points into ${dataDir}; the e2e run must use a throwaway database outside data/.`,
    );
  }
  return resolved;
}
