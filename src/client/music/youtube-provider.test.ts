import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackRef } from '../../domain/workout';
import type { YTNamespace, YTPlayerEvent, YTPlayerOptions } from '../youtube/loadIframeApi';
import {
  createYoutubeMusicProvider,
  PLAY_START_TIMEOUT_MS,
  type YoutubeMusicProvider,
} from './youtube-provider';

const track = (id: string): TrackRef => ({ provider: 'youtube', id, title: id, startAtSec: 0 });

interface FakePlayer {
  opts: YTPlayerOptions;
  calls: string[];
  volumes: number[];
  ready(): void;
  state(data: number): void;
  error(code: number): void;
}

let players: FakePlayer[];
let autoReady: boolean;
let autoPlay: boolean;

function makeApi(): YTNamespace {
  return {
    Player: class {
      constructor(el: HTMLElement, opts: YTPlayerOptions) {
        el.replaceWith(document.createElement('iframe'));
        const calls: string[] = [];
        const volumes: number[] = [];
        const self = {
          loadVideoById: (o: { videoId: string; startSeconds?: number }) => {
            calls.push(`load:${o.videoId}@${o.startSeconds ?? 0}`);
            if (autoPlay) queueMicrotask(() => opts.events?.onStateChange?.(event(1)));
          },
          setVolume: (v: number) => {
            calls.push(`volume:${v}`);
            volumes.push(v);
          },
          playVideo: () => calls.push('play'),
          pauseVideo: () => calls.push('pause'),
          mute: () => undefined,
          unMute: () => undefined,
          destroy: () => calls.push('destroy'),
        };
        const event = (data?: number): YTPlayerEvent => ({
          target: self,
          ...(data !== undefined ? { data } : {}),
        });
        const fake: FakePlayer = {
          opts,
          calls,
          volumes,
          ready: () => opts.events?.onReady?.(event()),
          state: (d) => opts.events?.onStateChange?.(event(d)),
          error: (c) => opts.events?.onError?.(event(c)),
        };
        players.push(fake);
        if (autoReady) {
          queueMicrotask(() => {
            fake.ready();
            if (autoPlay) fake.state(1);
          });
        }
      }
    } as unknown as YTNamespace['Player'],
  };
}

let provider: YoutubeMusicProvider;
const sleep = vi.fn(() => Promise.resolve());

beforeEach(() => {
  players = [];
  autoReady = true;
  autoPlay = true;
  sleep.mockClear();
  provider = createYoutubeMusicProvider({ loadApi: () => Promise.resolve(makeApi()), sleep });
});

afterEach(() => {
  provider.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('YouTube music provider', () => {
  it('is not ready until connected, and refuses to play before that', async () => {
    expect(provider.kind).toBe('youtube');
    expect(provider.isReady()).toBe(false);
    await expect(provider.play(track('abc'), 0)).rejects.toThrow(/not connected/);
    await provider.connect();
    expect(provider.isReady()).toBe(true);
  });

  it('a failing API load rejects connect and stays not ready', async () => {
    const broken = createYoutubeMusicProvider({
      loadApi: () => Promise.reject(new Error('blocked')),
    });
    await expect(broken.connect()).rejects.toThrow('blocked');
    expect(broken.isReady()).toBe(false);
  });

  it('creates one hidden, off-screen player for the first track and starts at the offset', async () => {
    await provider.connect();
    await provider.play(track('abc'), 42.9);
    expect(players).toHaveLength(1);
    expect(players[0]?.opts.videoId).toBe('abc');
    expect(players[0]?.opts.playerVars).toMatchObject({ autoplay: 1, start: 42, controls: 0 });
    const hidden = document.body.querySelector<HTMLElement>('div[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
    expect(hidden?.style.opacity).toBe('0');
    expect(hidden?.style.left).toBe('-10000px');
    expect(hidden?.style.pointerEvents).toBe('none');
  });

  it('loads later tracks into the same player', async () => {
    await provider.connect();
    await provider.play(track('abc'), 0);
    await provider.play(track('def'), 90);
    expect(players).toHaveLength(1);
    expect(players[0]?.calls).toEqual(['volume:100', 'volume:100', 'load:def@90']);
  });

  it('keeps the volume it was given across tracks', async () => {
    await provider.connect();
    await provider.setVolume(0.5);
    await provider.play(track('abc'), 0);
    await provider.play(track('def'), 0);
    expect(players[0]?.calls).toEqual(['volume:50', 'volume:50', 'load:def@0']);
  });

  it('fades out in steps down to silence, then pauses', async () => {
    await provider.connect();
    await provider.play(track('abc'), 0);
    players[0]?.calls.splice(0);
    await provider.fadeOut(1500);
    const volumes = players[0]?.volumes.slice(-10) ?? [];
    expect(volumes).toHaveLength(10);
    expect(volumes[0]).toBe(90);
    expect(volumes[9]).toBe(0);
    expect([...volumes].sort((a, b) => b - a)).toEqual(volumes);
    expect(sleep).toHaveBeenCalledTimes(10);
    expect(sleep).toHaveBeenCalledWith(150);
    expect(players[0]?.calls.at(-1)).toBe('pause');
  });

  it('a fade that is overtaken by a new track stops without pausing it', async () => {
    let release: () => void = () => undefined;
    const gated = createYoutubeMusicProvider({
      loadApi: () => Promise.resolve(makeApi()),
      sleep: () => new Promise<void>((resolve) => (release = resolve)),
    });
    await gated.connect();
    await gated.play(track('abc'), 0);
    const fade = gated.fadeOut(1500);
    await Promise.resolve();
    await gated.play(track('def'), 0);
    release();
    await fade;
    expect(players[0]?.calls).not.toContain('pause');
    expect(players[0]?.calls.at(-1)).toBe('load:def@0');
    gated.dispose();
  });

  it('pause and resume drive the player and restore the volume', async () => {
    await provider.connect();
    await provider.play(track('abc'), 0);
    players[0]?.calls.splice(0);
    await provider.pause();
    await provider.resume();
    expect(players[0]?.calls).toEqual(['pause', 'volume:100', 'play']);
  });

  it('clamps the volume to 0..1', async () => {
    await provider.connect();
    await provider.play(track('abc'), 0);
    await provider.setVolume(3);
    await provider.setVolume(-1);
    expect(players[0]?.volumes.slice(-2)).toEqual([100, 0]);
  });

  it('rejects play when the player reports an error (blocked video)', async () => {
    autoPlay = false;
    await provider.connect();
    const playing = provider.play(track('abc'), 0);
    await vi.waitFor(() => expect(players).toHaveLength(1));
    players[0]?.error(150);
    await expect(playing).rejects.toThrow(/150/);
  });

  it('rejects a later track that errors, and can play the one after it', async () => {
    await provider.connect();
    await provider.play(track('abc'), 0);
    autoPlay = false;
    const bad = provider.play(track('bad'), 0);
    await vi.waitFor(() => expect(players[0]?.calls).toContain('load:bad@0'));
    players[0]?.error(101);
    await expect(bad).rejects.toThrow(/101/);
    autoPlay = true;
    await provider.play(track('good'), 5);
    expect(players).toHaveLength(1);
  });

  it('rejects when the video never starts (autoplay blocked)', async () => {
    vi.useFakeTimers();
    autoPlay = false;
    await provider.connect();
    const playing = provider.play(track('abc'), 0);
    const assertion = expect(playing).rejects.toThrow(/did not start/);
    await vi.advanceTimersByTimeAsync(PLAY_START_TIMEOUT_MS);
    await assertion;
  });

  it('starts over with a new player after one that never became ready', async () => {
    vi.useFakeTimers();
    autoReady = false;
    await provider.connect();
    const first = provider.play(track('abc'), 0);
    const assertion = expect(first).rejects.toThrow(/did not start/);
    await vi.advanceTimersByTimeAsync(PLAY_START_TIMEOUT_MS);
    await assertion;
    expect(document.body.querySelector('div[aria-hidden="true"]')).toBeNull();

    autoReady = true;
    await provider.play(track('abc'), 0);
    expect(players).toHaveLength(2);
  });

  it('dispose destroys the player and removes its frame', async () => {
    await provider.connect();
    await provider.play(track('abc'), 0);
    provider.dispose();
    expect(players[0]?.calls).toContain('destroy');
    expect(document.body.querySelector('div[aria-hidden="true"]')).toBeNull();
  });

  it('pause, resume and fadeOut before any track do nothing', async () => {
    await provider.connect();
    await provider.pause();
    await provider.resume();
    await provider.fadeOut(1500);
    expect(players).toHaveLength(0);
  });
});
