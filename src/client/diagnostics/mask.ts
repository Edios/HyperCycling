/**
 * Masks what must not leave the device in a diagnostics report: keys, tokens, auth codes and
 * links to (possibly private) playlists. Applied to the whole exported text, last.
 */

const HIDDEN = '***';

const RULES: readonly [RegExp, string][] = [
  // "Authorization: Bearer xyz"
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, `$1 ${HIDDEN}`],
  // JWT-shaped tokens anywhere
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, HIDDEN],
  // key=value / key: value for anything that names a secret
  [
    /\b([\w-]*(?:token|secret|password|api_?key|apikey)|code|key|sig|signature)(\s*[=:]\s*)(["']?)[^&\s"',;}]+/gi,
    `$1$2$3${HIDDEN}`,
  ],
  // Spotify playlist links and URIs
  [/(open\.spotify\.com\/(?:[\w-]+\/)?playlist\/)[A-Za-z0-9]+/g, `$1${HIDDEN}`],
  [/spotify:playlist:[A-Za-z0-9]+/g, `spotify:playlist:${HIDDEN}`],
  // YouTube playlist ids (the video id stays: it is what a failed song is found by)
  [/([?&]list=)[\w-]+/g, `$1${HIDDEN}`],
  // Long opaque strings (keys, refresh tokens) that slipped through without a name
  [/\b[A-Za-z0-9_-]{32,}\b/g, HIDDEN],
];

export function maskSensitive(text: string): string {
  return RULES.reduce((out, [re, to]) => out.replace(re, to), text);
}

/** Setting names that hold credentials or private links; left out of the snapshot entirely. */
const SECRET_KEY = /token|secret|password|key|clientid|deviceid|url/i;

/** A copy of the settings for the report: credentials and links removed, strings masked. */
export function safeSettingsSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeSettingsSnapshot);
  if (typeof value === 'string') return maskSensitive(value);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!SECRET_KEY.test(k)) out[k] = safeSettingsSnapshot(v);
  }
  return out;
}
