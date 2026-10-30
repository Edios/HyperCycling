import { useEffect, useRef } from 'react';
import { loadIframeApi, type YTPlayer } from './loadIframeApi';
import styles from './YouTubeBackground.module.css';

export type YoutubeFailure = 'embed-blocked' | 'unavailable';

/** YouTube player error codes: invalid id (2), HTML5 (5), not found (100), embedding off (101, 150). */
const ERROR_CODES = new Set([2, 5, 100, 101, 150]);
const EMBED_BLOCKED = new Set([101, 150]);
/** After the API has loaded the player must be ready within this time. */
export const PLAYER_READY_TIMEOUT_MS = 10_000;

export interface YouTubeBackgroundProps {
  videoId: string;
  startSec?: number;
  /** True while the engine is paused; the video follows. */
  paused: boolean;
  onFail: (reason: YoutubeFailure) => void;
}

/** Full-bleed looping video behind the HUD. Never receives pointer events. */
export function YouTubeBackground({
  videoId,
  startSec = 0,
  paused,
  onFail,
}: YouTubeBackgroundProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | undefined>(undefined);
  const readyRef = useRef(false);
  const pausedRef = useRef(paused);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    pausedRef.current = paused;
    onFailRef.current = onFail;
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (reason: YoutubeFailure): void => {
      if (!alive) return;
      alive = false;
      onFailRef.current(reason);
    };
    // YT replaces its target element, so it gets one React does not own.
    const target = document.createElement('div');
    frame.appendChild(target);

    loadIframeApi()
      .then((YT) => {
        if (!alive) return;
        timer = setTimeout(() => fail('unavailable'), PLAYER_READY_TIMEOUT_MS);
        const player = new YT.Player(target, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: 0,
            modestbranding: 1,
            playsinline: 1,
            loop: 1,
            playlist: videoId,
            start: startSec,
            rel: 0,
            fs: 0,
            disablekb: 1,
            iv_load_policy: 3,
          },
          events: {
            onReady: (e) => {
              // A player from a cleaned-up effect run may still become ready; ignore it.
              if (!alive) return;
              clearTimeout(timer);
              readyRef.current = true;
              e.target.mute();
              if (pausedRef.current) e.target.pauseVideo();
              else e.target.playVideo();
            },
            onError: (e) => {
              if (!alive) return;
              // Unknown codes keep the ready timeout running.
              if (e.data !== undefined && ERROR_CODES.has(e.data)) {
                clearTimeout(timer);
                fail(EMBED_BLOCKED.has(e.data) ? 'embed-blocked' : 'unavailable');
              }
            },
          },
        });
        playerRef.current = player;
      })
      .catch((err: unknown) => {
        console.warn('YouTube player could not start', err);
        fail('unavailable');
      });

    return () => {
      alive = false;
      clearTimeout(timer);
      readyRef.current = false;
      const player = playerRef.current;
      playerRef.current = undefined;
      try {
        // Before the player is ready `destroy` may not exist yet.
        player?.destroy?.();
      } catch (err) {
        console.warn('Stopping the YouTube player failed', err);
      }
      // YT replaced `target` with its iframe, so clear everything it put in the frame.
      frame.replaceChildren();
    };
  }, [videoId, startSec]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    if (paused) player.pauseVideo();
    else player.playVideo();
  }, [paused]);

  return (
    <div data-testid="youtube-background" className={styles.root} aria-hidden="true">
      <div ref={frameRef} className={styles.frame} />
      <div className={styles.scrim} />
    </div>
  );
}
