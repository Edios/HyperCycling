import type { Workout } from '../workout';

export type ImportResult =
  { ok: true; workout: Workout; warnings: string[] } | { ok: false; error: string };

export interface ParseOptions {
  /** Original file name; used for `source.file` and as a fallback workout name. */
  fileName?: string;
  /** Injected clock for `updatedAt` (tests). */
  now?: Date;
}

export interface ErgOptions extends ParseOptions {
  /** FTP in watts, used when the file has no FTP header and its values are watts. */
  ftp?: number;
}
