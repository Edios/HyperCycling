import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackRef } from '../../domain/workout';
import { createYoutubeMusicProvider, type YoutubeMusicProvider } from '../music/youtube-provider';

/** A preview plays this long, from where the song starts (spec §4). */
export const PREVIEW_SEC = 15;
/** Quiet start: a preview must never startle (owner). */
export const PREVIEW_VOLUME = 0.3;

export interface PreviewNow {
  /** Which song row plays (the caller's key). */
  key: string;
  track: TrackRef;
}

export interface Preview {
  /** The element YouTube's player is mounted in: the dock's slot. */
  slotRef: React.RefObject<HTMLDivElement | null>;
  now: PreviewNow | null;
  /** True once a preview failed to start; cleared by the next one. */
  failed: boolean;
  play(key: string, track: TrackRef): void;
  stop(): void;
}

/**
 * The 15 s preview of one song: YouTube's player in the dock (never started by itself, at 30%
 * volume, stopped after `PREVIEW_SEC` or by the rider). The player is created on the first press
 * and released with the screen. `createProvider` is a test seam.
 */
export function usePreview(
  createProvider: (parent: HTMLElement) => YoutubeMusicProvider = (parent) =>
    createYoutubeMusicProvider({ parent, visible: true }),
): Preview {
  const slotRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<YoutubeMusicProvider | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tokenRef = useRef(0);
  const [now, setNow] = useState<PreviewNow | null>(null);
  const [failed, setFailed] = useState(false);

  const clearTimer = (): void => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = undefined;
  };

  const stop = useCallback((): void => {
    tokenRef.current++;
    clearTimer();
    setNow(null);
    void providerRef.current?.pause();
  }, []);

  const play = useCallback(
    (key: string, track: TrackRef): void => {
      const slot = slotRef.current;
      if (!slot) return;
      const token = ++tokenRef.current;
      clearTimer();
      setFailed(false);
      setNow({ key, track });
      const provider = (providerRef.current ??= createProvider(slot));
      void (async () => {
        try {
          if (!provider.isReady()) await provider.connect();
          await provider.setVolume(PREVIEW_VOLUME);
          await provider.play(track, track.startAtSec);
          if (token !== tokenRef.current) return;
          timerRef.current = setTimeout(() => {
            if (token === tokenRef.current) stop();
          }, PREVIEW_SEC * 1000);
        } catch (err) {
          if (token !== tokenRef.current) return;
          console.warn('The song preview failed', err);
          clearTimer();
          setNow(null);
          setFailed(true);
        }
      })();
    },
    [createProvider, stop],
  );

  useEffect(
    () => () => {
      tokenRef.current++;
      clearTimer();
      providerRef.current?.dispose();
      providerRef.current = undefined;
    },
    [],
  );

  return { slotRef, now, failed, play, stop };
}
