import type { TrackRef } from '../../domain/workout';

/**
 * A source of music the director can drive. Every method may reject; the director treats a
 * rejection as a failed track (one warning, one retry) and never lets it touch the workout.
 */
export interface MusicProvider {
  readonly kind: 'spotify' | 'youtube';
  /** Prepares the provider (auth, player, device). Safe to call again once ready. */
  connect(): Promise<void>;
  /** Starts `track` at `offsetSec`, at the volume last set. Resolves once playback has started. */
  play(track: TrackRef, offsetSec: number): Promise<void>;
  /** Lowers the volume to silence over `ms` and pauses. The volume set before is kept for `play`. */
  fadeOut(ms: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** `v` is 0..1. */
  setVolume(v: number): Promise<void>;
  isReady(): boolean;
}
