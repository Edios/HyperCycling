import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export const BACKUPS_TO_KEEP = 10;
const BACKUP_NAME = /^spinning-tutor-\d{8}-\d{6}\.db$/;

const pad = (n: number): string => String(n).padStart(2, '0');

export function backupFileName(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `spinning-tutor-${date}-${time}.db`;
}

/**
 * Writes a consistent copy of the live database into `backupsDir` using SQLite's online backup
 * (safe with WAL, unlike copying the file) and prunes all but the newest backups.
 * Returns the path of the new backup. Throws when the backup cannot be written.
 */
export async function backupDb(
  db: { backup(toPath: string): Promise<unknown> },
  backupsDir: string,
  now: Date,
): Promise<string> {
  mkdirSync(backupsDir, { recursive: true });
  const target = path.join(backupsDir, backupFileName(now));
  await db.backup(target);
  pruneBackups(backupsDir);
  return target;
}

function pruneBackups(backupsDir: string): void {
  const names = readdirSync(backupsDir)
    .filter((f) => BACKUP_NAME.test(f))
    .sort(); // timestamp names sort chronologically
  for (const old of names.slice(0, Math.max(0, names.length - BACKUPS_TO_KEEP))) {
    rmSync(path.join(backupsDir, old), { force: true });
  }
}
