export type SpotifyErrorCode =
  /** No tokens, or the refresh token was rejected: the user has to connect again. */
  | 'notAuthorized'
  /** The OAuth redirect did not match the login this tab started (possible CSRF). */
  | 'stateMismatch'
  /** The user declined access, or Spotify returned an authorization error. */
  | 'authDenied'
  /** No active Spotify device (open Spotify on a phone or PC and start any track). */
  | 'noActiveDevice'
  /** Playback control through the Web API needs Spotify Premium. */
  | 'premiumRequired'
  | 'forbidden'
  /** Spotify refused the command in the player's current state (e.g. pausing while paused). */
  | 'restrictionViolated'
  | 'rateLimited'
  | 'network'
  | 'http';

/**
 * Typed failure of the Spotify provider. The message never contains tokens, codes or response
 * bodies, so it is safe to log and to show.
 */
export class SpotifyError extends Error {
  readonly code: SpotifyErrorCode;
  readonly status?: number;
  readonly retryAfterSec?: number;

  constructor(
    code: SpotifyErrorCode,
    options: { status?: number; retryAfterSec?: number; message?: string } = {},
  ) {
    super(options.message ?? `Spotify: ${code}`);
    this.name = 'SpotifyError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterSec !== undefined) this.retryAfterSec = options.retryAfterSec;
  }
}

export function isSpotifyError(err: unknown): err is SpotifyError {
  return err instanceof SpotifyError;
}
