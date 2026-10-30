import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createSqliteRepositories } from '../storage/sqlite';
import { backupDb, BACKUPS_TO_KEEP } from './backup';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'st-backup-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

it('writes a timestamped, readable copy of the database', async () => {
  const repos = createSqliteRepositories(path.join(dir, 'a.db'));
  await repos.players.put({ id: 'p1', name: 'Ola', ftp: 200 });
  const backupsDir = path.join(dir, 'backups');
  const file = await backupDb(repos, backupsDir, new Date(2026, 0, 2, 3, 4, 5));
  expect(path.basename(file)).toBe('spinning-tutor-20260102-030405.db');
  repos.close();
  const copy = new Database(file, { readonly: true });
  expect(copy.prepare('SELECT count(*) AS n FROM players').get()).toEqual({ n: 1 });
  copy.close();
});

it('keeps only the newest backups', async () => {
  const repos = createSqliteRepositories(path.join(dir, 'a.db'));
  const backupsDir = path.join(dir, 'backups');
  mkdirSync(backupsDir);
  for (let d = 1; d <= 12; d++) {
    const day = String(d).padStart(2, '0');
    writeFileSync(path.join(backupsDir, `spinning-tutor-202601${day}-000000.db`), 'x');
  }
  writeFileSync(path.join(backupsDir, 'notes.txt'), 'keep me');
  await backupDb(repos, backupsDir, new Date(2026, 1, 1, 0, 0, 0));
  repos.close();
  const files = readdirSync(backupsDir).filter((f) => f.endsWith('.db'));
  expect(files).toHaveLength(BACKUPS_TO_KEEP);
  expect(files).toContain('spinning-tutor-20260201-000000.db');
  expect(files).not.toContain('spinning-tutor-20260101-000000.db');
  expect(readdirSync(backupsDir)).toContain('notes.txt');
});
