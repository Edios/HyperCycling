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
const STATE_BUFFERING = 3;
/** Planned steps of the fade-out; each one is a `setVolume` call. */
const FADE_STEPS = 10;
const MAX_FADE_STEPS = 100;
/** The player must start playing this soon after `play`, else the track counts as failed. */
export const PLAY_START_TIMEOUT_MS = 7_000;
/** Buffering this long while the track should be playing counts as a stalled (failed) track. */
export const STALL_TIMEOUT_MS = 8_000;

export interface YoutubeMusicProviderOptions {
  /** Test seam. Defaults to the shared IFrame API loader. */
  loadApi?: () => Promise<YTNamespace>;
  /** Where the hidden player is mounted. Defaults to `document.body`. */
  parent?: HTMLElement;
  /** Test seam for the wait between fade steps. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam for the clock the fade follows (milliseconds, monotonic). */
  now?: () => number;
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
  const now = options.now ?? (() => performance.now());

  let api: YTNamespace | undefined;
  let player: YTMusicPlayer | undefined;
  let playerReady: Promise<YTMusicPlayer> | undefined;
  let host: HTMLDivElement | undefined;
  let volume = 1;
  /** Bumped by anything that must stop a running fade. */
  let fadeGeneration = 0;
  let pending: Pending | undefined;
  let playToken = 0;
  /** Bumped when a player is created or dropped; callbacks of an older player are ignored. */
  let instance = 0;
  /** False while the track should be silent (paused, faded out, timed out, disposed). */
  let wantPlaying = false;
  let failureHandler: ((err: Error) => void) | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;

  const clearStall = (): void => {
    if (stallTimer !== undefined) clearTimeout(stallTimer);
    stallTimer = undefined;
  };
  /** The track broke down after it had started: tell the director, once. */
  const breakDown = (err: Error): void => {
    clearStall();
    wantPlaying = false;
    player?.pauseVideo();
    const handler = failureHandler;
    failureHandler = undefined;
    handler?.(err);
  };

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
    const mine = ++instance;

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
            if (mine !== instance) {
              // The player was dropped while it loaded; do not leave a detached one running.
              try {
                (e.target as YTMusicPlayer).destroy?.();
              } catch (err) {
                console.warn('Stopping a stale YouTube music player failed', err);
              }
              return;
            }
            player = e.target as YTMusicPlayer;
            apply();
            resolve(player);
          },
          onStateChange: (e: YTPlayerEvent) => {
            if (mine !== instance) return;
            if (e.data === STATE_BUFFERING) {
              // Started but stuck buffering: after a while it counts as failed.
              if (!pending && wantPlaying && stallTimer === undefined) {
                stallTimer = setTimeout(() => {
                  stallTimer = undefined;
                  if (mine === instance && wantPlaying) {
                    breakDown(new Error('YouTube track stalled while buffering'));
                  }
                }, STALL_TIMEOUT_MS);
              }
              return;
            }
            clearStall();
            if (e.data !== STATE_PLAYING) return;
            if (pending) settle();
            // Playing although nobody waits for it (a track that timed out, or a pause that
            // lost a race): keep it silent.
            else if (!wantPlaying) player?.pauseVideo();
          },
          onError: (e: YTPlayerEvent) => {
            if (mine !== instance) return;
            const err = new Error(`YouTube player error ${String(e.data)}`);
            const waiting = pending !== undefined;
            settle(err);
            reject(err); // no-op once the player is ready
            // An error while playing (not while starting): the director moves to the next recording.
            if (!waiting && wantPlaying) breakDown(err);
          },
        },
      });
    });
  }

  function waitForPlayback(): Promise<void> {
    settle(new Error('Superseded by a newer track'));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // The video may still start later; it must stay silent then.
        wantPlaying = false;
        settle(new Error('YouTube track did not start playing'));
        player?.pauseVideo();
      }, PLAY_START_TIMEOUT_MS);
      pending = { resolve, reject, timer };
    });
  }

  const dropPlayer = (): void => {
    instance++;
    clearStall();
    failureHandler = undefined;
    wantPlaying = false;
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
      clearStall();
      failureHandler = undefined;
      fadeGeneration++;
      const startSec = Math.max(0, Math.floor(offsetSec));
      const YT = api;
      wantPlaying = true;
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
      const startedAt = now();
      // The volume follows elapsed time, not the step count, so a throttled tab (late timers)
      // still ends the fade on schedule. The cap only guards against a stuck clock.
      let silent = false;
      for (let step = 0; step < MAX_FADE_STEPS && !silent; step++) {
        await sleep(ms / FADE_STEPS);
        if (generation !== fadeGeneration) return; // a newer play/pause took over
        const progress = ms <= 0 ? 1 : Math.min(1, (now() - startedAt) / ms);
        current.setVolume(Math.round(volume * 100 * (1 - progress)));
        silent = progress >= 1;
      }
      if (!silent) current.setVolume(0);
      wantPlaying = false;
      current.pauseVideo();
    },

    pause() {
      clearStall();
      fadeGeneration++;
      wantPlaying = false;
      player?.pauseVideo();
      return Promise.resolve();
    },

    resume() {
      fadeGeneration++;
      wantPlaying = true;
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

    setFailureHandler(handler) {
      failureHandler = handler;
    },

    dispose() {
      fadeGeneration++;
      dropPlayer();
    },
  };
}
