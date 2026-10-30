import { z } from 'zod';
import type { TrackRef } from '../../../domain/workout';
import type { MusicProvider } from '../types';
import { createSpotifyClient, type SpotifyClient, type SpotifyStore } from './client';
import { SpotifyError } from './errors';

export const FADE_STEPS = 6;

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface SpotifyProvider extends MusicProvider {
  readonly kind: 'spotify';
  /** Devices that can currently receive playback (for the settings device picker). */
  listDevices(): Promise<SpotifyDevice[]>;
  /** Track search for the editor; results are ready-to-use track references. */
  search(query: string): Promise<TrackRef[]>;
  /** Drops the stored tokens (client id and device choice stay). */
  disconnect(): Promise<void>;
}

export interface SpotifyProviderOptions {
  store: SpotifyStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** Resolves after `ms`; injected so tests and the fade do not depend on real timers. */
  sleep?: (ms: number) => Promise<void>;
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
      }),
    ),
  }),
});

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
  /** Level the user asked for (0..1); fades return to it. */
  let baseVolume = 1;

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

  async function putVolume(device: string, level: number): Promise<void> {
    await client.request('PUT', '/v1/me/player/volume', {
      query: { volume_percent: Math.round(level * 100), device_id: device },
    });
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
    },

    /**
     * Lowers the volume to 0 in FADE_STEPS equal steps over `ms`, pauses, then puts the volume
     * back to the chosen level so the next track starts at normal loudness.
     */
    async fadeOut(ms) {
      const device = await resolveDeviceId();
      const stepMs = Math.max(0, ms) / FADE_STEPS;
      let failure: unknown;
      try {
        for (let i = 1; i <= FADE_STEPS; i++) {
          await sleep(stepMs);
          await putVolume(device, baseVolume * (1 - i / FADE_STEPS));
        }
        await client.request('PUT', '/v1/me/player/pause', { query: { device_id: device } });
      } catch (err) {
        failure = err;
      }
      // Always try to undo the fade, even after a failure, so the volume is not left at 0.
      try {
        await putVolume(device, baseVolume);
      } catch (err) {
        failure ??= err;
      }
      if (failure) throw failure;
    },

    async pause() {
      const device = await resolveDeviceId();
      try {
        await client.request('PUT', '/v1/me/player/pause', { query: { device_id: device } });
      } catch (err) {
        // Spotify answers 403 "Restriction violated" when the player is already paused.
        if (!(err instanceof SpotifyError && err.code === 'forbidden')) throw err;
      }
    },

    async resume() {
      const device = await resolveDeviceId();
      await client.request('PUT', '/v1/me/player/play', { query: { device_id: device } });
    },

    async setVolume(v) {
      baseVolume = clamp01(v);
      await putVolume(await resolveDeviceId(), baseVolume);
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

    async disconnect() {
      connected = false;
      await client.clearCredentials();
    },
  };
}
