import type { MessageKey } from '../i18n';

export interface Translated {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/** Parser errors are English text; map the known ones to translatable messages. */
export function translateImportError(reason: string): Translated {
  if (reason.startsWith('FTP is required')) return { key: 'importer.e.needFtp' };
  if (reason === 'No workout blocks found') return { key: 'importer.e.noBlocks' };
  if (reason === 'File is empty') return { key: 'importer.e.empty' };
  if (reason === 'File too large') return { key: 'importer.tooBig' };
  if (reason === 'Too many blocks') return { key: 'importer.e.tooMany' };
  if (reason.startsWith('DOCTYPE')) return { key: 'importer.e.unsupported' };
  if (reason.startsWith('Not a Zwift')) return { key: 'importer.e.notZwo' };
  return { key: 'importer.e.generic' };
}

/** Parser warnings carry the position in English; map them to generic translatable notes. */
export function translateImportWarning(w: string): Translated | undefined {
  const unknown = /^Unknown element <(.+)> skipped$/.exec(w);
  if (unknown) return { key: 'importer.w.unknownElement', params: { tag: unknown[1] ?? '' } };
  if (w.includes('zero-length block dropped')) return { key: 'importer.w.zeroLength' };
  if (/clamped to/.test(w)) return { key: 'importer.w.clamped' };
  if (/block skipped|segment skipped|line skipped/.test(w)) return { key: 'importer.w.skipped' };
  if (w.startsWith('FTP header')) return { key: 'importer.w.badFtp' };
  return undefined;
}
