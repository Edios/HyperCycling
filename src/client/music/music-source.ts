import { useSyncExternalStore } from 'react';
import { DEFAULT_MUSIC_SOURCE, MUSIC_SOURCES, type MusicSource } from '../../domain/music-chain';

const KEY = 'hypercycling.music.source';
const listeners = new Set<() => void>();

/** The rider's choice of where Experience music comes from; YouTube unless they chose otherwise. */
export function getMusicSource(): MusicSource {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (MUSIC_SOURCES as readonly string[]).includes(v)) return v as MusicSource;
  } catch {
    // blocked storage: the default
  }
  return DEFAULT_MUSIC_SOURCE;
}

export function setMusicSource(next: MusicSource): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // not kept this time
  }
  for (const l of [...listeners]) l();
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const useMusicSource = (): MusicSource =>
  useSyncExternalStore(subscribe, getMusicSource, () => DEFAULT_MUSIC_SOURCE);
