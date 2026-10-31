import { parseExportBundle, stripSecrets, type ParseExportResult } from '../../domain/export-bundle';
import type { Repositories } from '../../domain/repositories';

export type DownloadFn = (blob: Blob, fileName: string) => void | Promise<void>;

export type ImportResult =
  | { ok: true }
  | {
      ok: false;
      reason: Extract<ParseExportResult, { ok: false }>['reason'] | 'failed';
      details?: string;
    };

const pad = (n: number): string => String(n).padStart(2, '0');

/** `spinning-tutor-YYYYMMDD-HHmm.json` in local time. */
export function exportFileName(now: Date, prefix = 'spinning-tutor'): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${prefix}-${date}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

/** `Blob.text()` with a FileReader fallback (jsdom and very old browsers lack it). */
export function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(blob);
  });
}

export async function exportToFile(repos: Repositories): Promise<Blob> {
  const bundle = stripSecrets(await repos.exportAll());
  return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
}

/** Saves a blob through a temporary link, which works in every browser without extra permissions. */
export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface ImportOptions {
  /**
   * Called with an export of the current data before it is replaced. Defaults to a browser
   * download on the IndexedDB build (no server to keep a backup) and to nothing on the HTTP
   * build, where the server snapshots the database itself. Pass `undefined` to skip it.
   */
  download?: DownloadFn | undefined;
  now?: () => Date;
}

const defaultDownload = (): DownloadFn | undefined =>
  import.meta.env.VITE_STORAGE === 'indexeddb' ? triggerDownload : undefined;

/** Reads and validates a file without touching any data; used before the replace confirm. */
export async function checkImportFile(file: Blob): Promise<ImportResult> {
  try {
    const parsed = parseExportBundle(await readBlobText(file));
    if (parsed.ok) return { ok: true };
    return parsed.details === undefined
      ? { ok: false, reason: parsed.reason }
      : { ok: false, reason: parsed.reason, details: parsed.details };
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Validates the file first; only a valid bundle ever reaches the backup and replace steps, so
 * a bad file leaves existing data untouched.
 */
export async function importFromFile(
  repos: Repositories,
  file: Blob,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const parsed = parseExportBundle(await readBlobText(file));
  if (!parsed.ok) {
    return parsed.details === undefined
      ? { ok: false, reason: parsed.reason }
      : { ok: false, reason: parsed.reason, details: parsed.details };
  }
  const download = 'download' in options ? options.download : defaultDownload();
  const now = options.now ?? (() => new Date());
  try {
    if (download) {
      await download(await exportToFile(repos), exportFileName(now(), 'spinning-tutor-backup'));
    }
    await repos.replaceAll(parsed.bundle);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      details: err instanceof Error ? err.message : String(err),
    };
  }
}
