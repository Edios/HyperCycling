import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export const BACKUPS_TO_KEEP = 10;
const BACKUP_NAME = /^spinning-tutor-(\d{8}-\d{6})(?:-(\d+))?\.db$/;

const pad = (n: number): string => String(n).padStart(2, '0');

export function backupFileName(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `spinning-tutor-${date}-${time}.db`;
}

/** First free name for this second: `...ss.db`, then `...ss-2.db`, `...ss-3.db`. */
function uniqueTarget(backupsDir: string, now: Date): string {
  const base = backupFileName(now).replace(/\.db$/, '');
  let target = path.join(backupsDir, `${base}.db`);
  for (let n = 2; existsSync(target); n++) target = path.join(backupsDir, `${base}-${n}.db`);
  return target;
}

/**
 * Writes a consistent copy of the live database into `backupsDir` using SQLite's online backup
 * (safe with WAL, unlike copying the file) and prunes all but the newest backups.
 * Returns the path of the new backup. Throws when the backup cannot be written; a failure while
 * pruning old backups is reported to `onPruneError` and otherwise ignored.
 */
export async function backupDb(
  db: { backup(toPath: string): Promise<unknown> },
  backupsDir: string,
  now: Date,
  onPruneError: (err: unknown) => void = () => undefined,
): Promise<string> {
  mkdirSync(backupsDir, { recursive: true });
  const target = uniqueTarget(backupsDir, now);
  await db.backup(target);
  try {
    pruneBackups(backupsDir);
  } catch (err) {
    onPruneError(err);
  }
  return target;
}

function sortKey(name: string): [string, number] {
  const m = BACKUP_NAME.exec(name);
  return [m?.[1] ?? '', Number(m?.[2] ?? 1)];
}

function pruneBackups(backupsDir: string): void {
  const names = readdirSync(backupsDir)
    .filter((f) => BACKUP_NAME.test(f))
    .sort((a, b) => {
      const [ta, na] = sortKey(a);
      const [tb, nb] = sortKey(b);
      return ta < tb ? -1 : ta > tb ? 1 : na - nb;
    }); // oldest first
  for (const old of names.slice(0, Math.max(0, names.length - BACKUPS_TO_KEEP))) {
    rmSync(path.join(backupsDir, old), { force: true });
  }
}
