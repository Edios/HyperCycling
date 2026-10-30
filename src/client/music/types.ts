import type { TrackRef } from '../../domain/workout';

export interface MusicProvider {
  readonly kind: 'spotify' | 'youtube';
  connect(): Promise<void>;
  play(track: TrackRef, offsetSec: number): Promise<void>;
  fadeOut(ms: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  setVolume(v: number): Promise<void>;
  isReady(): boolean;
}
