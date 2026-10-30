import type { MessageKey } from '../../i18n';
import { isSpotifyError } from './errors';

/** The localized explanation of a failed Spotify call (never shows tokens or response bodies). */
export function spotifyErrorKey(err: unknown): MessageKey {
  if (!isSpotifyError(err)) return 'music.error.generic';
  switch (err.code) {
    case 'noActiveDevice':
      return 'music.error.noDevice';
    case 'premiumRequired':
      return 'music.error.premium';
    case 'notAuthorized':
      return 'music.error.notConnected';
    case 'rateLimited':
      return 'music.error.rateLimited';
    case 'network':
      return 'music.error.network';
    case 'stateMismatch':
      return 'music.error.stateMismatch';
    case 'authDenied':
      return 'music.error.authDenied';
    default:
      return 'music.error.generic';
  }
}
