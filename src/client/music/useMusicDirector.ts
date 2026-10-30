import { useEffect, useRef } from 'react';
import type { TrackRef } from '../../domain/workout';
import {
  subscribeSessionEvents,
  useSessionStore,
  type SessionRuntime,
} from '../training/session-store';
import { createMusicDirector } from './director';
import { createMusicProviders } from './providers';

/**
 * Runs the music director for the loaded session when its config has music on and the workout
 * has something to play. Otherwise it does nothing. `onWarning` is told about unplayable tracks.
 */
export function useMusicDirector(
  runtime: SessionRuntime,
  onWarning: (track: TrackRef) => void,
): void {
  const warningRef = useRef(onWarning);
  useEffect(() => {
    warningRef.current = onWarning;
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
      getState: () => useSessionStore.getState().state,
      subscribeEvents: subscribeSessionEvents,
      subscribeState: (cb) => useSessionStore.subscribe(cb),
      onWarning: (track) => warningRef.current(track),
    });
    director.start();
    return () => {
      director.dispose();
      providers.dispose();
    };
  }, [enabled, segments, cues, fallback]);
}
