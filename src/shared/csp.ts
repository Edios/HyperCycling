/**
 * Content-Security-Policy shared by both builds: the Pages build embeds it as a `<meta>` tag
 * (GitHub Pages cannot set headers), the local server sends it as a header.
 *
 * Third parties, and why each is allowed:
 *  - www.youtube.com / s.ytimg.com in script-src: IFrame API script and the player widget script.
 *  - www.youtube.com (+ youtube-nocookie.com) in frame-src: the background/music player iframe.
 *  - www.youtube.com in connect-src: the oEmbed availability check.
 *  - api.spotify.com / accounts.spotify.com in connect-src: Web API calls and the PKCE token
 *    exchange. (The authorize step is a top-level navigation, which CSP does not govern.)
 *  - open.spotify.com in connect-src: the oEmbed track-title lookup (works without a login).
 *  - api.getsong.co in connect-src: the optional GetSongBPM tempo lookup (allows browser requests).
 *  - api.deezer.com is NOT allowed in the page's own policy. The keyless Deezer tempo lookup (opt-in,
 *    off by default, Settings -> Music) needs JSONP because the API sends no CORS headers, and JSONP
 *    runs the answer as script. So that script runs in a sandboxed same-origin iframe
 *    (public/deezer-bridge.html, `sandbox="allow-scripts"` = opaque origin: no access to our storage,
 *    tokens or DOM) under its own policy, BRIDGE_CSP below. The page only needs `'self'` in
 *    frame-src for it, and the iframe exists only while the setting is on. Residual risk: a
 *    compromised api.deezer.com could run script inside that empty sandbox and send us forged
 *    answers; every answer is validated again by the page (src/client/music/deezer/client.ts).
 * Styles are external files only: React's `style` props go through CSSOM, which CSP allows.
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", 'https://www.youtube.com', 'https://s.ytimg.com'],
  'frame-src': ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
  'connect-src': [
    "'self'",
    'https://api.spotify.com',
    'https://accounts.spotify.com',
    'https://www.youtube.com',
    'https://open.spotify.com',
    'https://api.getsong.co',
  ],
  'img-src': ["'self'", 'data:'],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

/** Policy of the sandboxed Deezer bridge page: the only place that may run script from Deezer. */
export const BRIDGE_CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'none'"],
  'script-src': ["'self'", 'https://api.deezer.com'],
  'base-uri': ["'none'"],
};

/** Path of the bridge page under the app's base URL. */
export const DEEZER_BRIDGE_FILE = 'deezer-bridge.html';

const serialize = (extra: Record<string, string[]> = {}): string =>
  Object.entries({ ...CSP_DIRECTIVES, ...extra })
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');

export const BRIDGE_CSP = Object.entries(BRIDGE_CSP_DIRECTIVES)
  .map(([name, values]) => `${name} ${values.join(' ')}`)
  .join('; ');

/** For the `<meta>` tag: `frame-ancestors` is ignored there, so it is left out. */
export const PAGE_CSP = serialize();

/** For the local server's response header. */
export const SERVER_CSP = serialize({ 'frame-ancestors': ["'none'"] });
