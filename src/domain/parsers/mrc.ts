import { parseCourse } from './erg';
import type { ErgOptions, ImportResult } from './types';

/** MRC is the percent-of-FTP variant of ERG. */
export function parseMrc(text: string, opts?: ErgOptions): ImportResult {
  return parseCourse(text, 'percent', opts);
}
