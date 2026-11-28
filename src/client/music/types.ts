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
   * Optional: `handler` is called once when the track that was started plays to its very end
   * (YouTube ENDED, Spotify stopped at the end). It is replaced by the next `play` or
   * `setEndHandler`. The director uses it to move on at once instead of keeping silence until the
   * planned end of a song whose recording turned out shorter.
   */
  setEndHandler?(handler: (() => void) | undefined): void;
  /**
   * Optional song clock: seconds into the recording that plays now, read from the player itself;
   * undefined while it is not playing (loading, buffering, an advert, paused).
   */
  position?(): number | undefined;
  /**
   * Optional: looks up the name (and artists) of a track. The director uses it for tracks saved
   * without a title; it may reject and never holds up playback.
   */
  describeTrack?(track: TrackRef): Promise<TrackInfo | undefined>;
}

/** What a provider knows about a track's name (and, when it says, its length). */
export interface TrackInfo {
  title: string;
  artist?: string;
  durationSec?: number;
}
