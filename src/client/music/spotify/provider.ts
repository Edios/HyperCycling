import { z } from 'zod';
import type { TrackRef } from '../../../domain/workout';
import type { MusicProvider, TrackInfo } from '../types';
import { createSpotifyClient, type SpotifyClient, type SpotifyStore } from './client';
import { isSpotifyError, SpotifyError } from './errors';

export const FADE_STEPS = 6;

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  /** Number of items as Spotify reports it (0 when unknown). */
  total: number;
}

/** A search hit with what matching needs: the explicit flag and availability in the user's market. */
export interface SpotifyTrackHit {
  ref: TrackRef;
  explicit: boolean;
  /** False = Spotify says it cannot be played in the user's country; undefined = not reported. */
  playable: boolean | undefined;
  album?: string;
}

export interface PlaylistTrack {
  id: string;
  title: string;
  artist?: string;
}

export interface SpotifyProvider extends MusicProvider {
  readonly kind: 'spotify';
  /** Devices that can currently receive playback (for the settings device picker). */
  listDevices(): Promise<SpotifyDevice[]>;
  /** Track search for the editor; results are ready-to-use track references. */
  search(query: string): Promise<TrackRef[]>;
  /**
   * Track search with `market=from_token` (the rider's own country), so each hit says whether it
   * is playable there. At most `limit` hits (default 8).
   */
  searchTracks(query: string, limit?: number): Promise<SpotifyTrackHit[]>;
  /** The user's own playlists (GET /v1/me/playlists; needs the playlist-read scopes). */
  listPlaylists(): Promise<SpotifyPlaylist[]>;
  /** Tracks of one playlist the user owns or collaborates on, at most `max` (default 500). */
  playlistTracks(playlistId: string, max?: number): Promise<PlaylistTrack[]>;
  /** Name and artists of a track (GET /v1/tracks/{id}). */
  describeTrack(track: TrackRef): Promise<TrackInfo>;
  /** Drops the stored tokens (client id and device choice stay). */
  disconnect(): Promise<void>;
}

export interface SpotifyProviderOptions {
  store: SpotifyStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** Resolves after `ms`; injected so tests and the fade do not depend on real timers. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Spotify only takes commands (no player events), so after a track starts the provider asks the
   * player every `watchdogMs` whether it still plays that track, and reports a failure (the
   * director then moves to the song's next recording). 0 / absent = off.
   */
  watchdogMs?: number;
}

const devicesSchema = z.object({
  devices: z.array(
    z.object({
      id: z.string().nullable(),
      name: z.string(),
      type: z.string(),
      is_active: z.boolean(),
    }),
  ),
});

const searchSchema = z.object({
  tracks: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        duration_ms: z.number(),
        artists: z.array(z.object({ name: z.string() })),
        explicit: z.boolean().optional(),
        is_playable: z.boolean().optional(),
        album: z.object({ name: z.string() }).optional(),
      }),
    ),
  }),
});

const playlistsSchema = z.object({
  items: z.array(
    z
      .object({
        id: z.string(),
        name: z.string(),
        // Feb 2026 API: `items`; earlier: `tracks`.
        items: z.object({ total: z.number() }).optional(),
        tracks: z.object({ total: z.number() }).optional(),
      })
      .nullable(),
  ),
  next: z.string().nullable().optional(),
});

const playlistItemsSchema = z.object({
  items: z.array(
    z
      .object({
        // Feb 2026 API: `item`; earlier: `track`. Episodes, local files and gaps are skipped.
        item: z.unknown().optional(),
        track: z.unknown().optional(),
      })
      .nullable(),
  ),
  next: z.string().nullable().optional(),
});

const playlistTrackSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9]{1,40}$/),
  name: z.string().min(1),
  type: z.string().optional(),
  is_local: z.boolean().optional(),
  artists: z.array(z.object({ name: z.string() })).optional(),
});

const PAGE = 50;
const MAX_PLAYLIST_PAGES = 6;

const trackSchema = z.object({
  name: z.string(),
  artists: z.array(z.object({ name: z.string() })),
});

const playerSchema = z.object({
  device: z
    .object({ id: z.string().nullable(), volume_percent: z.number().nullable().optional() })
    .nullable()
    .optional(),
});

const nowPlayingSchema = z
  .object({
    is_playing: z.boolean().optional(),
    progress_ms: z.number().nullable().optional(),
    item: z
      .object({ id: z.string().nullable().optional(), duration_ms: z.number().optional() })
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

/** Bad readings in a row before the track counts as failed (one hiccup is not enough). */
const WATCHDOG_STRIKES = 2;
/** Near the end of the track "not playing" just means it ended. */
const END_GRACE_MS = 4000;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

export function createSpotifyProvider(options: SpotifyProviderOptions): SpotifyProvider {
  const client: SpotifyClient = createSpotifyClient({
    store: options.store,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const sleep = options.sleep ?? defaultSleep;
  let connected = false;
  /** The device volume (0..100) from before the session was muted; restored on unmute. */
  let volumeBeforeMute: number | undefined;
  const now = options.now ?? Date.now;
  let failureHandler: ((err: Error) => void) | undefined;
  let lastTrackId: string | undefined;
  let watch: { timer: ReturnType<typeof setInterval>; id: string; strikes: number } | undefined;

  const stopWatch = (): void => {
    if (watch) clearInterval(watch.timer);
    watch = undefined;
  };

  /** One look at the player: true when it plays `id` (or has just finished it). */
  async function playsTrack(id: string): Promise<boolean> {
    const parsed = nowPlayingSchema.safeParse(await client.request('GET', '/v1/me/player'));
    if (!parsed.success) return true; // an odd answer proves nothing
    const p = parsed.data;
    if (!p || !p.item) return false; // no active player / nothing loaded
    if (p.item.id !== id) return false;
    if (p.is_playing) return true;
    const left = (p.item.duration_ms ?? Infinity) - (p.progress_ms ?? 0);
    return left <= END_GRACE_MS; // stopped at the end: finished, not broken
  }

  function startWatch(id: string): void {
    stopWatch();
    const every = options.watchdogMs ?? 0;
    if (!(every > 0)) return;
    const mine = { id, strikes: 0, timer: undefined as unknown as ReturnType<typeof setInterval> };
    mine.timer = setInterval(() => {
      void (async () => {
        let ok = true;
        try {
          ok = await playsTrack(id);
        } catch {
          return; // a network or rate-limit hiccup is not a verdict
        }
        if (watch !== mine) return; // replaced or stopped while asking
        mine.strikes = ok ? 0 : mine.strikes + 1;
        if (mine.strikes < WATCHDOG_STRIKES) return;
        stopWatch();
        const handler = failureHandler;
        failureHandler = undefined;
        handler?.(new Error('Spotify stopped playing the track'));
      })();
    }, every);
    watch = mine;
  }

  async function listDevices(): Promise<SpotifyDevice[]> {
    const body = await client.request('GET', '/v1/me/player/devices');
    const parsed = devicesSchema.safeParse(body);
    if (!parsed.success) throw new SpotifyError('http');
    return parsed.data.devices.flatMap((d) =>
      d.id ? [{ id: d.id, name: d.name, type: d.type, isActive: d.is_active }] : [],
    );
  }

  /** The chosen device, otherwise the first active one. */
  async function resolveDeviceId(): Promise<string> {
    const chosen = options.store.read()?.deviceId;
    if (chosen) return chosen;
    const active = (await listDevices()).find((d) => d.isActive);
    if (!active) throw new SpotifyError('noActiveDevice');
    return active.id;
  }

  async function putVolume(device: string, percent: number): Promise<void> {
    await client.request('PUT', '/v1/me/player/volume', {
      query: { volume_percent: Math.round(percent), device_id: device },
    });
  }

  /** The device's current volume (0..100), or undefined when Spotify does not report it. */
  async function currentVolume(device: string): Promise<number | undefined> {
    const parsed = playerSchema.safeParse(await client.request('GET', '/v1/me/player'));
    const d = parsed.success ? parsed.data.device : undefined;
    // Only trust the reading when it belongs to the device we are about to fade.
    return d && d.id === device && typeof d.volume_percent === 'number'
      ? d.volume_percent
      : undefined;
  }

  return {
    kind: 'spotify',

    /** Verifies stored credentials (refreshing when needed). Does not open the consent page. */
    async connect() {
      await client.ensureToken();
      connected = true;
    },

    isReady() {
      return connected && client.hasCredentials();
    },

    async play(track, offsetSec) {
      if (track.provider !== 'spotify') {
        throw new SpotifyError('http', { message: 'Spotify: not a Spotify track' });
      }
      const device = await resolveDeviceId();
      await client.request('PUT', '/v1/me/player/play', {
        query: { device_id: device },
        body: {
          uris: [`spotify:track:${track.id}`],
          position_ms: Math.max(0, Math.round(offsetSec * 1000)),
        },
      });
      lastTrackId = track.id;
      startWatch(track.id);
    },

    setFailureHandler(handler) {
      failureHandler = handler;
    },

    /**
     * Reads the device's current volume, lowers it to 0 in FADE_STEPS equal steps over `ms`
     * (step i is due at start + i * ms / FADE_STEPS, so request latency does not stretch the
     * fade), pauses, then puts the original volume back for the next track. When the device
     * does not report a volume it only pauses: guessing a level could make things louder.
     */
    async fadeOut(ms) {
      stopWatch();
      const device = await resolveDeviceId();
      const original = await currentVolume(device);
      if (original === undefined) {
        await client.request('PUT', '/v1/me/player/pause', { query: { device_id: device } });
        return;
      }
      const stepMs = Math.max(0, ms) / FADE_STEPS;
      const start = now();
      let failure: unknown;
      try {
        for (let i = 1; i <= FADE_STEPS; i++) {
          await sleep(Math.max(0, start + i * stepMs - now()));
          await putVolume(device, original * (1 - i / FADE_STEPS));
        }
        await client.request('PUT', '/v1/me/player/pause', { query: { device_id: device } });
      } catch (err) {
        failure = err;
      }
      // Always try to undo the fade, even after a failure, so the volume is not left at 0.
      try {
        await putVolume(device, original);
      } catch (err) {
        failure ??= err;
      }
      if (failure) throw failure;
    },

    async pause() {
      stopWatch();
      const device = await resolveDeviceId();
      try {
        await client.request('PUT', '/v1/me/player/pause', { query: { device_id: device } });
      } catch (err) {
        // Spotify answers 403 "Restriction violated" when the player is already paused.
        if (!(err instanceof SpotifyError && err.code === 'restrictionViolated')) throw err;
      }
    },

    async resume() {
      const device = await resolveDeviceId();
      await client.request('PUT', '/v1/me/player/play', { query: { device_id: device } });
      if (lastTrackId) startWatch(lastTrackId);
    },

    /**
     * `v` scales the user's own device level: 0 mutes (remembering the level it found), anything
     * above 0 brings it back, 1 being the remembered level (100 % when it was never read).
     */
    async setVolume(v) {
      const device = await resolveDeviceId();
      const level = clamp01(v);
      if (level === 0) {
        if (volumeBeforeMute === undefined) {
          const current = await currentVolume(device).catch(() => undefined);
          if (current !== undefined && current > 0) volumeBeforeMute = current;
        }
        await putVolume(device, 0);
        return;
      }
      await putVolume(device, (volumeBeforeMute ?? 100) * level);
      if (level === 1) volumeBeforeMute = undefined;
    },

    listDevices,

    async search(query) {
      const q = query.trim();
      if (!q) return [];
      const body = await client.request('GET', '/v1/search', {
        query: { q, type: 'track', limit: 10 },
      });
      const parsed = searchSchema.safeParse(body);
      if (!parsed.success) throw new SpotifyError('http');
      return parsed.data.tracks.items.map((t) => ({
        provider: 'spotify' as const,
        id: t.id,
        title: t.name,
        ...(t.artists.length ? { artist: t.artists.map((a) => a.name).join(', ') } : {}),
        durationSec: Math.round(t.duration_ms / 1000),
        startAtSec: 0,
      }));
    },

    async searchTracks(query, limit = 8) {
      const q = query.trim();
      if (!q) return [];
      let body: unknown;
      let regionFailed = false;
      try {
        body = await client.request('GET', '/v1/search', {
          query: { q, type: 'track', limit, market: 'from_token' },
        });
      } catch (err) {
        // `from_token` may need a scope this app does not ask for (user-read-private). Any other
        // client error: ask again without a market; the hits then carry no availability.
        const status = isSpotifyError(err) ? err.status : undefined;
        const clientError =
          status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 429;
        if (!clientError) throw err;
        body = await client.request('GET', '/v1/search', {
          query: { q, type: 'track', limit },
        });
        regionFailed = true;
      }
      const parsed = searchSchema.safeParse(body);
      if (!parsed.success) throw new SpotifyError('http');
      return parsed.data.tracks.items.map((t) => ({
        ref: {
          provider: 'spotify' as const,
          id: t.id,
          title: t.name,
          ...(t.artists.length ? { artist: t.artists.map((a) => a.name).join(', ') } : {}),
          durationSec: Math.round(t.duration_ms / 1000),
          startAtSec: 0,
        },
        explicit: t.explicit ?? false,
        // Absent = the region was not checked (Spotify did not say); never assumed playable.
        playable: regionFailed ? undefined : t.is_playable,
        ...(t.album ? { album: t.album.name } : {}),
      }));
    },

    async listPlaylists() {
      const out: SpotifyPlaylist[] = [];
      for (let page = 0; page < MAX_PLAYLIST_PAGES; page++) {
        const body = await client.request('GET', '/v1/me/playlists', {
          query: { limit: PAGE, offset: page * PAGE },
        });
        const parsed = playlistsSchema.safeParse(body);
        if (!parsed.success) throw new SpotifyError('http');
        for (const p of parsed.data.items) {
          if (!p) continue;
          out.push({
            id: p.id,
            name: p.name.slice(0, 200),
            total: p.items?.total ?? p.tracks?.total ?? 0,
          });
        }
        if (!parsed.data.next) break;
      }
      return out;
    },

    async playlistTracks(playlistId, max = 500) {
      const out: PlaylistTrack[] = [];
      for (let offset = 0; out.length < max; offset += PAGE) {
        const body = await client.request(
          'GET',
          `/v1/playlists/${encodeURIComponent(playlistId)}/items`,
          { query: { limit: PAGE, offset, additional_types: 'track' } },
        );
        const parsed = playlistItemsSchema.safeParse(body);
        if (!parsed.success) throw new SpotifyError('http');
        for (const entry of parsed.data.items) {
          const t = playlistTrackSchema.safeParse(entry?.item ?? entry?.track);
          if (!t.success || t.data.is_local || (t.data.type && t.data.type !== 'track')) continue;
          const artist = (t.data.artists ?? []).map((a) => a.name).join(', ');
          out.push({
            id: t.data.id,
            title: t.data.name,
            ...(artist ? { artist } : {}),
          });
          if (out.length >= max) break;
        }
        if (!parsed.data.next) break;
      }
      return out;
    },

    async describeTrack(track) {
      const body = await client.request('GET', `/v1/tracks/${encodeURIComponent(track.id)}`);
      const parsed = trackSchema.safeParse(body);
      if (!parsed.success) throw new SpotifyError('http');
      const artist = parsed.data.artists.map((a) => a.name).join(', ');
      return { title: parsed.data.name, ...(artist ? { artist } : {}) };
    },

    async disconnect() {
      connected = false;
      await client.clearCredentials();
    },
  };
}
