import type { TrackRef } from '../../domain/workout';
import {
  loadIframeApi,
  type YTNamespace,
  type YTPlayer,
  type YTPlayerEvent,
} from '../youtube/loadIframeApi';
import type { MusicProvider } from './types';

/** The part of the IFrame player the music provider needs beyond what the background uses. */
export interface YTMusicPlayer extends YTPlayer {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  setVolume(volume: number): void;
}

const STATE_PLAYING = 1;
/** Steps of the fade-out; each one is a `setVolume` call. */
const FADE_STEPS = 10;
/** The player must start playing this soon after `play`, else the track counts as failed. */
export const PLAY_START_TIMEOUT_MS = 8_000;

export interface YoutubeMusicProviderOptions {
  /** Test seam. Defaults to the shared IFrame API loader. */
  loadApi?: () => Promise<YTNamespace>;
  /** Where the hidden player is mounted. Defaults to `document.body`. */
  parent?: HTMLElement;
  /** Test seam for the wait between fade steps. */
  sleep?: (ms: number) => Promise<void>;
}

export interface YoutubeMusicProvider extends MusicProvider {
  readonly kind: 'youtube';
  /** Destroys the hidden player. The provider can be connected again afterwards. */
  dispose(): void;
}

interface Pending {
  resolve(): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Plays YouTube tracks through a hidden IFrame player that is separate from the video
 * background. Only audio is wanted, so the frame is kept off screen.
 */
export function createYoutubeMusicProvider(
  options: YoutubeMusicProviderOptions = {},
): YoutubeMusicProvider {
  const loadApi = options.loadApi ?? (() => loadIframeApi());
  const sleep = options.sleep ?? defaultSleep;

  let api: YTNamespace | undefined;
  let player: YTMusicPlayer | undefined;
  let playerReady: Promise<YTMusicPlayer> | undefined;
  let host: HTMLDivElement | undefined;
  let volume = 1;
  /** Bumped by anything that must stop a running fade. */
  let fadeGeneration = 0;
  let pending: Pending | undefined;
  let playToken = 0;

  const settle = (err?: Error): void => {
    const p = pending;
    if (!p) return;
    pending = undefined;
    clearTimeout(p.timer);
    if (err) p.reject(err);
    else p.resolve();
  };

  const apply = (): void => player?.setVolume(Math.round(volume * 100));

  function createPlayer(
    YT: YTNamespace,
    videoId: string,
    startSec: number,
  ): Promise<YTMusicPlayer> {
    const parent = options.parent ?? document.body;
    const frame = document.createElement('div');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:200px;height:200px;opacity:0;pointer-events:none;';
    const target = document.createElement('div');
    frame.appendChild(target);
    parent.appendChild(frame);
    host = frame;

    return new Promise<YTMusicPlayer>((resolve, reject) => {
      new YT.Player(target, {
        videoId,
        width: 200,
        height: 200,
        playerVars: {
          autoplay: 1,
          controls: 0,
          playsinline: 1,
          start: startSec,
          rel: 0,
          fs: 0,
          disablekb: 1,
        },
        events: {
          onReady: (e: YTPlayerEvent) => {
            player = e.target as YTMusicPlayer;
            apply();
            resolve(player);
          },
          onStateChange: (e: YTPlayerEvent) => {
            if (e.data === STATE_PLAYING) settle();
          },
          onError: (e: YTPlayerEvent) => {
            const err = new Error(`YouTube player error ${String(e.data)}`);
            settle(err);
            reject(err); // no-op once the player is ready
          },
        },
      });
    });
  }

  function waitForPlayback(): Promise<void> {
    settle(new Error('Superseded by a newer track'));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => settle(new Error('YouTube track did not start playing')),
        PLAY_START_TIMEOUT_MS,
      );
      pending = { resolve, reject, timer };
    });
  }

  const dropPlayer = (): void => {
    settle(new Error('YouTube music player was disposed'));
    const p = player;
    player = undefined;
    playerReady = undefined;
    try {
      p?.destroy?.();
    } catch (err) {
      console.warn('Stopping the YouTube music player failed', err);
    }
    host?.remove();
    host = undefined;
  };

  return {
    kind: 'youtube',

    async connect() {
      api ??= await loadApi();
    },

    async play(track: TrackRef, offsetSec: number) {
      if (!api) throw new Error('YouTube music provider is not connected');
      const token = ++playToken;
      fadeGeneration++;
      const startSec = Math.max(0, Math.floor(offsetSec));
      const YT = api;
      const playback = waitForPlayback();
      const start = (async (): Promise<void> => {
        if (!playerReady) {
          playerReady = createPlayer(YT, track.id, startSec);
          await playerReady;
          return;
        }
        const ready = await playerReady;
        if (token !== playToken) return; // a newer play took over while waiting
        apply();
        ready.loadVideoById({ videoId: track.id, startSeconds: startSec });
      })();
      try {
        await Promise.all([start, playback]);
      } catch (err) {
        // A player that never became ready would block every later track: start over.
        if (token === playToken && !player) dropPlayer();
        throw err;
      }
    },

    async fadeOut(ms) {
      const current = player;
      if (!current) return;
      const generation = ++fadeGeneration;
      const wait = ms / FADE_STEPS;
      for (let i = 1; i <= FADE_STEPS; i++) {
        await sleep(wait);
        if (generation !== fadeGeneration) return; // a newer play/pause took over
        current.setVolume(Math.round(volume * 100 * (1 - i / FADE_STEPS)));
      }
      current.pauseVideo();
    },

    pause() {
      fadeGeneration++;
      player?.pauseVideo();
      return Promise.resolve();
    },

    resume() {
      fadeGeneration++;
      apply();
      player?.playVideo();
      return Promise.resolve();
    },

    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      apply();
      return Promise.resolve();
    },

    isReady() {
      return api !== undefined;
    },

    dispose() {
      fadeGeneration++;
      dropPlayer();
    },
  };
}
