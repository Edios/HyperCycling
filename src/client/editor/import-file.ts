import { parseErg } from '../../domain/parsers/erg';
import { parseMrc } from '../../domain/parsers/mrc';
import { parseZwo } from '../../domain/parsers/zwo';
import type { Workout } from '../../domain/workout';
import type { MessageKey } from '../i18n';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export type ImportOutcome =
  | { ok: true; workout: Workout; warnings: string[] }
  | { ok: false; errorKey: MessageKey; reason?: string };

type Parser = (text: string, opts: { fileName: string }) => ReturnType<typeof parseZwo>;

const PARSERS: Record<string, Parser> = {
  zwo: parseZwo,
  erg: parseErg,
  mrc: parseMrc,
};

export interface FileLike {
  name: string;
  size: number;
  text(): Promise<string>;
}

/** Validates, reads and parses an uploaded .zwo/.erg/.mrc file (at most 2 MB). */
export async function importFile(file: FileLike): Promise<ImportOutcome> {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  const parse = PARSERS[ext];
  if (!parse) return { ok: false, errorKey: 'importer.badType' };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, errorKey: 'importer.tooBig' };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, errorKey: 'importer.readFailed' };
  }
  const result = parse(text, { fileName: file.name });
  if (!result.ok) return { ok: false, errorKey: 'importer.parseFailed', reason: result.error };
  return { ok: true, workout: result.workout, warnings: result.warnings };
}
