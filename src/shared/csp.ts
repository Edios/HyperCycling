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
 * Styles are external files only: React's `style` props go through CSSOM, which CSP allows.
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", 'https://www.youtube.com', 'https://s.ytimg.com'],
  'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
  'connect-src': [
    "'self'",
    'https://api.spotify.com',
    'https://accounts.spotify.com',
    'https://www.youtube.com',
    'https://open.spotify.com',
  ],
  'img-src': ["'self'", 'data:'],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

const serialize = (extra: Record<string, string[]> = {}): string =>
  Object.entries({ ...CSP_DIRECTIVES, ...extra })
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');

/** For the `<meta>` tag: `frame-ancestors` is ignored there, so it is left out. */
export const PAGE_CSP = serialize();

/** For the local server's response header. */
export const SERVER_CSP = serialize({ 'frame-ancestors': ["'none'"] });
