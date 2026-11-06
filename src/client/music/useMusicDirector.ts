import { useEffect, useRef } from 'react';
import type { TrackRef } from '../../domain/workout';
import {
  subscribeSessionEvents,
  useSessionStore,
  type SessionRuntime,
} from '../training/session-store';
import { createMusicDirector, SWITCH_FADE_MS, type MusicDirector } from './director';
import { createMusicProviders } from './providers';

/**
 * Runs the music director for the loaded session when its config has music on and the workout
 * has something to play. Otherwise it does nothing. `onWarning` is told about unplayable tracks.
 */
export function useMusicDirector(
  runtime: SessionRuntime,
  onWarning: (track: TrackRef, error?: unknown) => void,
  options: {
    /** 0..1; 0 while the session is muted. Changes are applied to the running director. */
    volume?: number;
    onPlaying?: (track: TrackRef | null) => void;
  } = {},
): void {
  const volume = options.volume ?? 1;
  const warningRef = useRef(onWarning);
  const playingRef = useRef(options.onPlaying);
  const volumeRef = useRef(volume);
  const directorRef = useRef<MusicDirector | undefined>(undefined);
  useEffect(() => {
    warningRef.current = onWarning;
    playingRef.current = options.onPlaying;
    volumeRef.current = volume;
    directorRef.current?.setVolume(volume);
  });

  const { segments, config, workout } = runtime;
  const enabled = config.music;
  const cues = workout.musicCues;
  const fallback = workout.fallbackPlaylist;

  useEffect(() => {
    if (!enabled || (cues.length === 0 && fallback.length === 0)) return undefined;
    const providers = createMusicProviders();
    const director = createMusicDirector({
      segments,
      cues,
      fallback,
      getProvider: (kind) => providers.get(kind),
      // The store snapshot is refreshed by the engine loop (requestAnimationFrame). In a hidden tab
      // that loop stops, so the schedule freezes with it and the poll sees the same snapshot; the
      // music catches up through the engine's `skipped` segment event when the tab returns.
      getState: () => useSessionStore.getState().state,
      subscribeEvents: subscribeSessionEvents,
      subscribeState: (cb) => useSessionStore.subscribe(cb),
      onWarning: (track, error) => warningRef.current(track, error),
      onPlaying: (track) => playingRef.current?.(track),
      volume: volumeRef.current,
      switchFadeMs: SWITCH_FADE_MS,
    });
    directorRef.current = director;
    director.start();
    return () => {
      directorRef.current = undefined;
      playingRef.current?.(null);
      director.dispose();
      providers.dispose();
    };
  }, [enabled, segments, cues, fallback]);
}
