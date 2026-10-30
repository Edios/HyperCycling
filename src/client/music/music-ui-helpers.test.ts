import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { SpotifyError, type SpotifyErrorCode } from './spotify/errors';
import { spotifyErrorKey } from './spotify/messages';
import { isSpotifyUsable } from './spotify/shared';
import { checkYoutubeEmbeddable } from './youtube-check';
import { createMusicProviders } from './providers';
import { settingsSpotifyStore } from './spotify/settings-store';
import { loadSettings, resetSettingsForTests, updateSettings } from '../data/useSettings';
import { vi } from 'vitest';

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
    }),
}));

describe('spotifyErrorKey', () => {
  it.each<[SpotifyErrorCode, string]>([
    ['noActiveDevice', 'music.error.noDevice'],
    ['premiumRequired', 'music.error.premium'],
    ['notAuthorized', 'music.error.notConnected'],
    ['rateLimited', 'music.error.rateLimited'],
    ['network', 'music.error.network'],
    ['stateMismatch', 'music.error.stateMismatch'],
    ['authDenied', 'music.error.authDenied'],
    ['http', 'music.error.generic'],
    ['forbidden', 'music.error.generic'],
  ])('%s -> %s', (code, key) => expect(spotifyErrorKey(new SpotifyError(code))).toBe(key));

  it('treats anything else as generic', () => {
    expect(spotifyErrorKey(new Error('x'))).toBe('music.error.generic');
    expect(spotifyErrorKey(undefined)).toBe('music.error.generic');
  });
});

describe('checkYoutubeEmbeddable', () => {
  const reply = (status: number, body?: unknown): typeof fetch =>
    (() =>
      Promise.resolve(
        new Response(body === undefined ? null : JSON.stringify(body), { status }),
      )) as typeof fetch;

  it('reads title and author of an embeddable video', async () => {
    expect(
      await checkYoutubeEmbeddable('abc', reply(200, { title: 'T', author_name: 'A' })),
    ).toEqual({ status: 'ok', title: 'T', author: 'A' });
  });

  it('maps 401/403 to blocked, 404 to missing, other statuses to unknown', async () => {
    expect((await checkYoutubeEmbeddable('abc', reply(401))).status).toBe('blocked');
    expect((await checkYoutubeEmbeddable('abc', reply(403))).status).toBe('blocked');
    expect((await checkYoutubeEmbeddable('abc', reply(404))).status).toBe('missing');
    expect((await checkYoutubeEmbeddable('abc', reply(500))).status).toBe('unknown');
  });

  it('is unknown when the network fails or the body is not JSON', async () => {
    const down = (() => Promise.reject(new Error('offline'))) as typeof fetch;
    expect((await checkYoutubeEmbeddable('abc', down)).status).toBe('unknown');
    const junk = (() => Promise.resolve(new Response('<html>', { status: 200 }))) as typeof fetch;
    expect((await checkYoutubeEmbeddable('abc', junk)).status).toBe('unknown');
  });

  it('asks oEmbed for the watch URL of the id', async () => {
    let seen = '';
    const spy = ((url: string) => {
      seen = url;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
    await checkYoutubeEmbeddable('dQw4w9WgXcQ', spy);
    expect(decodeURIComponent(seen)).toContain('watch?v=dQw4w9WgXcQ');
  });
});

describe('Spotify registration', () => {
  it('needs both tokens and a Client ID', () => {
    expect(isSpotifyUsable(undefined)).toBe(false);
    expect(isSpotifyUsable({ clientId: 'cid' })).toBe(false);
    expect(isSpotifyUsable({ clientId: '', refreshToken: 'RT' })).toBe(false);
    expect(isSpotifyUsable({ clientId: 'cid', refreshToken: 'RT' })).toBe(true);
  });

  it('createMusicProviders offers Spotify only once connected', async () => {
    resetSettingsForTests();
    await loadSettings();
    const providers = createMusicProviders();
    expect(providers.get('spotify')).toBeUndefined();
    expect(providers.get('youtube')?.kind).toBe('youtube');
    await updateSettings({ spotify: { clientId: 'cid', refreshToken: 'RT' } });
    expect(settingsSpotifyStore.read()?.clientId).toBe('cid');
    expect(providers.get('spotify')?.kind).toBe('spotify');
    providers.dispose();
    expect(DEFAULT_SETTINGS.spotify).toBeUndefined();
  });
});
