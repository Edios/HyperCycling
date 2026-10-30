import { handleCallback, type AuthEnv } from './auth';
import { withTokens, type SpotifyStore } from './client';
import { SpotifyError } from './errors';

/** What the UI may see of a callback: never the tokens themselves. */
export type SpotifyCallbackOutcome =
  | { status: 'none' }
  | { status: 'connected'; clientId: string }
  | { status: 'error'; error: SpotifyError };

let last: SpotifyCallbackOutcome = { status: 'none' };

/** Outcome of the redirect handled at app load, for the settings screen to report. */
export function getLastSpotifyCallbackResult(): SpotifyCallbackOutcome {
  return last;
}

async function run(
  store: SpotifyStore,
  options: Parameters<typeof handleCallback>[0] & AuthEnv,
): Promise<SpotifyCallbackOutcome> {
  const result = await handleCallback(options);
  if (result.status !== 'connected') return result;
  try {
    await store.write(withTokens({ ...store.read(), clientId: result.clientId }, result.tokens));
  } catch {
    return {
      status: 'error',
      error: new SpotifyError('http', { message: 'Spotify: saving credentials failed' }),
    };
  }
  return { status: 'connected', clientId: result.clientId };
}

/**
 * Runs once at app load, before the first render: when the URL carries the OAuth redirect
 * (`?code=`), verifies it, exchanges the code and saves the tokens into `settings.spotify`,
 * then the address bar is cleaned. Never throws: failures (including blocked sessionStorage)
 * come back as `{ status: 'error' }`.
 */
export async function completeSpotifyCallbackOnLoad(
  store: SpotifyStore,
  options: Parameters<typeof handleCallback>[0] & AuthEnv = {},
): Promise<SpotifyCallbackOutcome> {
  try {
    last = await run(store, options);
  } catch {
    last = { status: 'error', error: new SpotifyError('http') };
  }
  return last;
}
