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
  /**
   * Optional: `handler` is called when the track that was started breaks down later (player
   * error, stalled buffering). It is replaced by the next `play` or `setFailureHandler`; the
   * director uses it to move on to the song's next recording.
   */
  setFailureHandler?(handler: ((err: Error) => void) | undefined): void;
  /**
   * Optional: looks up the name (and artists) of a track. The director uses it for tracks saved
   * without a title; it may reject and never holds up playback.
   */
  describeTrack?(track: TrackRef): Promise<TrackInfo | undefined>;
}

/** What a provider knows about a track's name. */
export interface TrackInfo {
  title: string;
  artist?: string;
}
