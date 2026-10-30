import { describe, expect, it } from 'vitest';
import { translateImportError, translateImportWarning } from './import-messages';

describe('import messages', () => {
  it('maps known parser errors', () => {
    const ftp = 'FTP is required to convert watts (no FTP in the file header)';
    expect(translateImportError(ftp).key).toBe('importer.e.needFtp');
    expect(translateImportError('No workout blocks found').key).toBe('importer.e.noBlocks');
    expect(translateImportError('something odd').key).toBe('importer.e.generic');
  });
  it('maps known warnings and leaves unknown ones', () => {
    expect(translateImportWarning('Unknown element <Mystery> skipped')).toEqual({
      key: 'importer.w.unknownElement',
      params: { tag: 'Mystery' },
    });
    expect(translateImportWarning('x: zero-length block dropped')?.key).toBe(
      'importer.w.zeroLength',
    );
    expect(
      translateImportWarning('x: intensity 300% FTP is out of range, clamped to 200%')?.key,
    ).toBe('importer.w.clamped');
    expect(translateImportWarning('x: missing Duration, block skipped')?.key).toBe(
      'importer.w.skipped',
    );
    expect(translateImportWarning('???')).toBeUndefined();
  });
});
