import { t, type MessageKey } from '../i18n';

/**
 * Content texts (segment cue and label) may be tokens `@<key>` that map to the
 * dictionary (`coach.<key>` for cues, `block.<key>` for labels). Unknown tokens
 * show the bare key; any other text is returned verbatim.
 */
export function translateContentText(text: string, kind: 'cue' | 'label'): string {
  if (!text.startsWith('@')) return text;
  const key = text.slice(1);
  const full = `${kind === 'cue' ? 'coach' : 'block'}.${key}`;
  const translated = t(full as MessageKey);
  return translated === full ? key : translated;
}
