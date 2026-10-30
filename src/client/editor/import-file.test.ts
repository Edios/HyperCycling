import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importFile, MAX_IMPORT_BYTES, type FileLike } from './import-file';

const fixture = (name: string): FileLike => {
  const text = readFileSync(join(process.cwd(), 'src/domain/parsers/__fixtures__', name), 'utf8');
  return { name, size: text.length, text: () => Promise.resolve(text) };
};

describe('importFile', () => {
  it('parses a .zwo and marks the source as import with the file name', async () => {
    const r = await importFile(fixture('normal.zwo'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.workout.source).toEqual({ kind: 'import', file: 'normal.zwo' });
      expect(r.workout.blocks.length).toBeGreaterThan(0);
    }
  });

  it('returns parser warnings for a messy file', async () => {
    const r = await importFile(fixture('messy.zwo'));
    expect(r.ok && r.warnings.length).toBeGreaterThan(0);
  });

  it('parses .mrc and .erg', async () => {
    expect((await importFile(fixture('percent.mrc'))).ok).toBe(true);
    expect((await importFile(fixture('watts-ftp.erg'))).ok).toBe(true);
  });

  it('reports parse errors with the reason', async () => {
    const r = await importFile(fixture('malformed.zwo'));
    expect(r).toMatchObject({ ok: false, errorKey: 'importer.parseFailed' });
    if (!r.ok) expect(r.reason).toBeTruthy();
  });

  it('rejects unknown extensions and files over 2 MB without reading them', async () => {
    let read = false;
    const spy = (name: string, size: number): FileLike => ({
      name,
      size,
      text: () => {
        read = true;
        return Promise.resolve('');
      },
    });
    expect(await importFile(spy('a.txt', 10))).toMatchObject({ errorKey: 'importer.badType' });
    expect(await importFile(spy('a.zwo', MAX_IMPORT_BYTES + 1))).toMatchObject({
      errorKey: 'importer.tooBig',
    });
    expect(read).toBe(false);
  });

  it('reports unreadable files', async () => {
    const r = await importFile({
      name: 'a.zwo',
      size: 1,
      text: () => Promise.reject(new Error('boom')),
    });
    expect(r).toMatchObject({ ok: false, errorKey: 'importer.readFailed' });
  });
});
