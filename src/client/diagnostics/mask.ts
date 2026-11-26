/**
 * Masks what must not leave the device in a diagnostics report: keys, tokens, auth codes and
 * links to (possibly private) playlists. Applied to the whole exported text, last.
 */

const HIDDEN = '***';

/** Names whose value is always a secret, as a URL parameter, a header-like line or a JSON key. */
const SECRET_NAME = String.raw`[\w-]*(?:token|secret|password|passwd|api_?key|apikey)`;
/** Short names that are secrets only as URL parameters or JSON keys ("error code: 404" stays). */
const WEAK_NAME = 'code|key|sig|signature|si|auth';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RULES: readonly [RegExp, string | ((match: string) => string)][] = [
  // "Authorization: Bearer xyz"
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, `$1 ${HIDDEN}`],
  // JWT-shaped tokens anywhere
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, HIDDEN],
  // Secret names with a quoted value: "refresh_token": "…", password='…'
  [
    new RegExp(String.raw`\b(${SECRET_NAME})(["']?\s*[=:]\s*)(["'])[^"'\r\n]*(["'])`, 'gi'),
    `$1$2$3${HIDDEN}$4`,
  ],
  // Secret names with a bare value: access_token=…, apiKey: …
  [
    new RegExp(String.raw`\b(${SECRET_NAME})(["']?\s*[=:]\s*)(?!["'*])[^&\s"',;}]+`, 'gi'),
    `$1$2${HIDDEN}`,
  ],
  // Short names as URL parameters (?code=…, &si=…) and as JSON keys ("key": "…")
  [new RegExp(String.raw`([?&#;](?:${WEAK_NAME}))=[^&#\s"']+`, 'gi'), `$1=${HIDDEN}`],
  [new RegExp(String.raw`("(?:${WEAK_NAME})"\s*:\s*")[^"\r\n]*"`, 'gi'), `$1${HIDDEN}"`],
  // Spotify: user names in old links and URIs, then playlist ids after any number of segments
  [/(open\.spotify\.com\/(?:[^/?#\s]+\/)*?user\/)[^/?#\s]+/g, `$1${HIDDEN}`],
  [/(spotify:user:)[^\s:]+/g, `$1${HIDDEN}`],
  [/(open\.spotify\.com\/(?:[^/?#\s]+\/)*playlist\/)[A-Za-z0-9]+/g, `$1${HIDDEN}`],
  [/(spotify:(?:[^\s:]+:)*playlist:)[A-Za-z0-9]+/g, `$1${HIDDEN}`],
  // YouTube playlist ids (the video id stays: it is what a failed song is found by)
  [/([?&]list=)[\w-]+/g, `$1${HIDDEN}`],
  // Long opaque strings (keys, refresh tokens) that slipped through without a name; UUIDs (e.g.
  // Bluetooth services) are not secrets and stay readable.
  [/\b[A-Za-z0-9_-]{32,}\b/g, (m) => (UUID.test(m) ? m : HIDDEN)],
];

export function maskSensitive(text: string): string {
  return RULES.reduce(
    (out, [re, to]) => (typeof to === 'string' ? out.replace(re, to) : out.replace(re, to)),
    text,
  );
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
