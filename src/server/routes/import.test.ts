import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundle, workout } from '../../storage/contract';
import { buildServer } from '../app';
import { warmUpServer } from '../test-warmup';

await warmUpServer();

let dir: string;
let dbPath: string;
let app: FastifyInstance;
const backupsDir = (): string => path.join(dir, 'backups');
const backups = (): string[] => (existsSync(backupsDir()) ? readdirSync(backupsDir()) : []);

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'st-import-'));
  dbPath = path.join(dir, 'spinning-tutor.db');
  app = await buildServer({ dbPath });
  await app.inject({
    method: 'PUT',
    url: '/api/players/old',
    payload: { id: 'old', name: 'Old', ftp: 150 },
  });
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/import', payload: payload as object });
const playerIds = async (): Promise<string[]> =>
  (await app.inject({ method: 'GET', url: '/api/players' }))
    .json<{ id: string }[]>()
    .map((p) => p.id);

describe('POST /api/import', () => {
  it('rejects invalid bundles with a reason, leaves data untouched, creates no backup', async () => {
    const cases: unknown[] = [
      { app: 'other' },
      { app: 'spinning-tutor', schemaVersion: 0 },
      { app: 'spinning-tutor', schemaVersion: 2 },
      { ...bundle(), workouts: [{ ...workout('w1'), blocks: 'nope' }] },
    ];
    for (const c of cases) {
      const res = await post(c);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBeTruthy();
    }
    expect(await playerIds()).toEqual(['old']);
    expect(backups()).toEqual([]);
  });

  it('backs up first, then replaces data', async () => {
    const b = bundle();
    const res = await post(b);
    expect(res.statusCode).toBe(204);
    const files = backups();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^spinning-tutor-\d{8}-\d{6}\.db$/);
    expect(await playerIds()).toEqual(b.players.map((p) => p.id).sort());
  });

  it('the backup holds the data from before the import', async () => {
    await post(bundle());
    const copy = new Database(path.join(backupsDir(), backups()[0] as string), {
      readonly: true,
    });
    const ids = (copy.prepare('SELECT id FROM players').all() as { id: string }[]).map((r) => r.id);
    copy.close();
    expect(ids).toEqual(['old']);
  });

  it('clears a stored active session', async () => {
    const active = {
      workoutId: 'w1',
      config: { background: 'basic', hud: 'solo', playerIds: [], music: false },
      snapshot: { segmentIndex: 0, workoutElapsedSec: 0, status: 'paused' },
      savedAt: '2026-01-01T00:00:00.000Z',
    };
    const put = await app.inject({ method: 'PUT', url: '/api/active-session', payload: active });
    expect(put.statusCode).toBe(204);
    expect((await post(bundle())).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/active-session' })).statusCode).toBe(204);
  });

  it('fails with 500 and imports nothing when the backup cannot be written', async () => {
    writeFileSync(backupsDir(), 'a file where the directory should be');
    const res = await post(bundle());
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: string }>().error).toBe('Backup failed, nothing was imported');
    expect(await playerIds()).toEqual(['old']);
  });

  it('skips the backup for in-memory databases', async () => {
    const mem = await buildServer({ dbPath: ':memory:' });
    const res = await mem.inject({ method: 'POST', url: '/api/import', payload: bundle() });
    expect(res.statusCode).toBe(204);
    await mem.close();
  });

  it('413 for a body over 10 MB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ pad: 'x'.repeat(10 * 1024 * 1024 + 10) }),
    });
    expect(res.statusCode).toBe(413);
    expect(await playerIds()).toEqual(['old']);
  });
});
