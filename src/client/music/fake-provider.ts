import type { TrackRef } from '../../domain/workout';
import type { MusicProvider, TrackInfo } from './types';

export type FakeCall =
  | { type: 'connect' }
  | { type: 'play'; track: TrackRef; offsetSec: number }
  | { type: 'fadeOut'; ms: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'setVolume'; v: number };

export interface FakeMusicProviderOptions {
  kind?: 'spotify' | 'youtube';
  /** Start connected. Default true. */
  ready?: boolean;
  /** When set, `fadeOut` takes this long on the (fake) timer clock instead of resolving at once. */
  fadeDurationMs?: number;
  /** Gives the provider a `describeTrack` that answers with this. */
  describe?: (track: TrackRef) => Promise<TrackInfo | undefined>;
}

export interface FakeMusicProvider extends MusicProvider {
  readonly calls: FakeCall[];
  /** Short log such as `play:T1@30`, handy for exact assertions. */
  readonly log: string[];
  /** The next `n` calls to `play` reject. */
  failNextPlays(n: number): void;
  /** Makes `connect` reject until cleared. */
  failConnect(fail: boolean): void;
  /** Rejects `play` for any track the predicate accepts (until replaced). */
  failPlaysWhen(predicate: ((track: TrackRef) => boolean) | undefined): void;
  /** The error that failing plays reject with (default: a plain Error). */
  failPlaysWith(error: Error | undefined): void;
}

/** In-memory provider for tests: records calls and fails on demand. */
export function createFakeMusicProvider(options: FakeMusicProviderOptions = {}): FakeMusicProvider {
  const kind = options.kind ?? 'spotify';
  let ready = options.ready ?? true;
  let playFailures = 0;
  let connectFails = false;
  let failWhen: ((track: TrackRef) => boolean) | undefined;
  let failError: Error | undefined;
  const calls: FakeCall[] = [];
  const log: string[] = [];
  const record = (call: FakeCall, line: string): void => {
    calls.push(call);
    log.push(line);
  };

  return {
    kind,
    ...(options.describe ? { describeTrack: options.describe } : {}),
    calls,
    log,
    failNextPlays(n) {
      playFailures = n;
    },
    failConnect(fail) {
      connectFails = fail;
    },
    failPlaysWhen(predicate) {
      failWhen = predicate;
    },
    failPlaysWith(error) {
      failError = error;
    },
    connect() {
      record({ type: 'connect' }, 'connect');
      if (connectFails) return Promise.reject(new Error('connect failed'));
      ready = true;
      return Promise.resolve();
    },
    play(track, offsetSec) {
      record({ type: 'play', track, offsetSec }, `play:${track.id}@${Math.round(offsetSec)}`);
      if (playFailures > 0) {
        playFailures -= 1;
        return Promise.reject(failError ?? new Error('play failed'));
      }
      if (failWhen?.(track)) return Promise.reject(failError ?? new Error('play failed'));
      return Promise.resolve();
    },
    fadeOut(ms) {
      record({ type: 'fadeOut', ms }, `fadeOut:${ms}`);
      const wait = options.fadeDurationMs;
      if (wait === undefined) return Promise.resolve();
      return new Promise<void>((resolve) => setTimeout(resolve, wait));
    },
    pause() {
      record({ type: 'pause' }, 'pause');
      return Promise.resolve();
    },
    resume() {
      record({ type: 'resume' }, 'resume');
      return Promise.resolve();
    },
    setVolume(v) {
      record({ type: 'setVolume', v }, `setVolume:${v}`);
      return Promise.resolve();
    },
    isReady() {
      return ready;
    },
  };
}
