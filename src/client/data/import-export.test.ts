import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { bundle } from '../../storage/contract';
import { createIndexedDbRepositories } from '../../storage/indexeddb';
import { exportFileName, exportToFile, importFromFile, readBlobText } from './import-export';

let n = 0;
const makeRepos = () => createIndexedDbRepositories(`ie-db-${++n}`);
const file = (content: unknown): File =>
  new File([typeof content === 'string' ? content : JSON.stringify(content)], 'in.json');

describe('exportFileName', () => {
  it('formats local time as YYYYMMDD-HHmm', () => {
    const d = new Date(2026, 0, 2, 3, 4, 59);
    expect(exportFileName(d)).toBe('spinning-tutor-20260102-0304.json');
    expect(exportFileName(d, 'spinning-tutor-backup')).toBe('spinning-tutor-backup-20260102-0304.json');
  });
});

describe('exportToFile', () => {
  it('produces pretty JSON that parses back to the export bundle', async () => {
    const repos = await makeRepos();
    await repos.replaceAll(bundle());
    const blob = await exportToFile(repos);
    expect(blob.type).toBe('application/json');
    const text = await readBlobText(blob);
    expect(text).toContain('\n  ');
    expect(JSON.parse(text)).toMatchObject({ app: 'spinning-tutor', schemaVersion: 1 });
  });
});

describe('importFromFile', () => {
  it('rejects bad files with a reason, leaves data untouched, downloads nothing', async () => {
    const repos = await makeRepos();
    await repos.players.put({ id: 'old', name: 'Old', ftp: 200 });
    const download = vi.fn();
    const bad: unknown[] = ['not json', { app: 'other' }, { app: 'spinning-tutor', schemaVersion: 9 }];
    const reasons = [];
    for (const b of bad) {
      const r = await importFromFile(repos, file(b), { download });
      expect(r.ok).toBe(false);
      if (!r.ok) reasons.push(r.reason);
    }
    expect(reasons).toEqual(['notJson', 'wrongApp', 'unsupportedVersion']);
    expect(download).not.toHaveBeenCalled();
    expect((await repos.players.list()).map((p) => p.id)).toEqual(['old']);
  });

  it('downloads a backup of the current data before replacing it', async () => {
    const repos = await makeRepos();
    await repos.players.put({ id: 'old', name: 'Old', ftp: 200 });
    let seenAtDownload: string[] = [];
    const download = vi.fn(async (blob: Blob, name: string) => {
      seenAtDownload = (await repos.players.list()).map((p) => p.id);
      expect(name).toMatch(/^spinning-tutor-backup-\d{8}-\d{4}\.json$/);
      expect(JSON.parse(await readBlobText(blob)).players.map((p: { id: string }) => p.id)).toEqual(['old']);
    });
    const b = bundle();
    const r = await importFromFile(repos, file(b), { download });
    expect(r).toEqual({ ok: true });
    expect(download).toHaveBeenCalledTimes(1);
    expect(seenAtDownload).toEqual(['old']);
    expect((await repos.players.list()).map((p) => p.id)).toEqual(b.players.map((p) => p.id).sort());
  });

  it('does not download when no download hook is given (server makes the backup)', async () => {
    const repos = await makeRepos();
    const r = await importFromFile(repos, file(bundle()), { download: undefined });
    expect(r).toEqual({ ok: true });
  });

  it('reports a failed replace instead of throwing', async () => {
    const repos = await makeRepos();
    repos.replaceAll = () => Promise.reject(new Error('disk on fire'));
    const r = await importFromFile(repos, file(bundle()));
    expect(r).toEqual({ ok: false, reason: 'failed', details: 'disk on fire' });
  });
});
