import { handleCallback, type AuthEnv, type CallbackResult } from './auth';
import { SpotifyError } from './errors';
import { withTokens, type SpotifyStore } from './client';

let last: CallbackResult = { status: 'none' };

/** Outcome of the redirect handled at app load, for the settings screen to report. */
export function getLastSpotifyCallbackResult(): CallbackResult {
  return last;
}

/**
 * Runs once at app load, before the first render: when the URL carries the OAuth redirect
 * (`?code=`), verifies it, exchanges the code and saves the tokens into `settings.spotify`,
 * then the address bar is cleaned. Never throws: failures come back as `{ status: 'error' }`.
 */
export async function completeSpotifyCallbackOnLoad(
  store: SpotifyStore,
  options: Parameters<typeof handleCallback>[0] & AuthEnv = {},
): Promise<CallbackResult> {
  const result = await handleCallback(options);
  if (result.status === 'connected') {
    try {
      const existing = store.read();
      await store.write(withTokens({ ...existing, clientId: result.clientId }, result.tokens));
    } catch {
      last = {
        status: 'error',
        error: new SpotifyError('http', { message: 'Spotify: saving credentials failed' }),
      };
      return last;
    }
  }
  last = result;
  return result;
}
