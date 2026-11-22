import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackRef } from '../../domain/workout';
import type { YoutubeMusicProvider } from '../music/youtube-provider';
import { PREVIEW_SEC, PREVIEW_VOLUME, usePreview, type Preview } from './usePreview';

const track: TrackRef = { provider: 'youtube', id: 'abcdefghijk', title: 'A', startAtSec: 12 };
const other: TrackRef = { ...track, id: 'bbbbbbbbbbb', title: 'B' };

interface Fake extends YoutubeMusicProvider {
  log: string[];
}

function fakeProvider(opts: { failPlay?: boolean } = {}): Fake {
  const log: string[] = [];
  let ready = false;
  return {
    kind: 'youtube',
    log,
    connect: () => {
      ready = true;
      log.push('connect');
      return Promise.resolve();
    },
    isReady: () => ready,
    setVolume: (v: number) => {
      log.push(`volume:${v}`);
      return Promise.resolve();
    },
    play: (t: TrackRef, offset: number) => {
      log.push(`play:${t.id}@${offset}`);
      return opts.failPlay ? Promise.reject(new Error('nope')) : Promise.resolve();
    },
    pause: () => {
      log.push('pause');
      return Promise.resolve();
    },
    resume: () => Promise.resolve(),
    fadeOut: () => Promise.resolve(),
    setFailureHandler: () => undefined,
    setEndHandler: () => undefined,
    dispose: () => {
      log.push('dispose');
    },
  } as unknown as Fake;
}

let api: Preview;
let provider: Fake;
let created: HTMLElement[];

function Harness({ fail }: { fail?: boolean }) {
  const preview = usePreview((parent) => {
    created.push(parent);
    provider = fakeProvider(fail ? { failPlay: true } : {});
    return provider;
  });
  useEffect(() => {
    api = preview;
  });
  // The ref belongs to the element it is given to; the lint rule cannot tell through the hook.
  // eslint-disable-next-line react-hooks/refs
  return <div ref={preview.slotRef} data-testid="slot" />;
}

beforeEach(() => {
  vi.useFakeTimers();
  created = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

describe('usePreview', () => {
  it('plays a quiet preview from the start offset in the dock slot, and only when asked', async () => {
    render(<Harness />);
    expect(created).toHaveLength(0); // nothing is created until the first press
    act(() => api.play('s1:0', track));
    await flush();
    expect(created[0]).toBe(screen.getByTestId('slot'));
    expect(provider.log).toEqual(['connect', `volume:${PREVIEW_VOLUME}`, 'play:abcdefghijk@12']);
    expect(PREVIEW_VOLUME).toBeLessThanOrEqual(0.3);
    expect(api.now).toEqual({ key: 's1:0', track });
    expect(api.failed).toBe(false);
  });

  it('stops by itself after 15 seconds, or when asked', async () => {
    render(<Harness />);
    act(() => api.play('s1:0', track));
    await flush();
    await act(async () => void (await vi.advanceTimersByTimeAsync(PREVIEW_SEC * 1000 - 1)));
    expect(api.now).not.toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(2)));
    expect(api.now).toBeNull();
    expect(provider.log.at(-1)).toBe('pause');
    act(() => api.play('s1:1', other));
    await flush();
    expect(api.now?.key).toBe('s1:1');
    act(() => api.stop());
    expect(api.now).toBeNull();
    // The stopped preview's timer does not stop the next one.
    act(() => api.play('s1:2', track));
    await flush();
    await act(async () => void (await vi.advanceTimersByTimeAsync(PREVIEW_SEC * 1000 - 1)));
    expect(api.now?.key).toBe('s1:2');
  });

  it('reuses its player for the next song', async () => {
    render(<Harness />);
    act(() => api.play('s1:0', track));
    await flush();
    act(() => api.play('s1:1', other));
    await flush();
    expect(created).toHaveLength(1);
    expect(provider.log.filter((l) => l === 'connect')).toHaveLength(1);
    expect(provider.log.at(-1)).toBe('play:bbbbbbbbbbb@12');
  });

  it('says so when the preview cannot start, and clears that on the next press', async () => {
    const { unmount } = render(<Harness fail />);
    act(() => api.play('s1:0', track));
    await flush();
    expect(api.now).toBeNull();
    expect(api.failed).toBe(true);
    unmount();
    render(<Harness />);
    act(() => api.play('s1:0', track));
    await flush();
    expect(api.failed).toBe(false);
  });

  it('releases the player when the screen goes away', async () => {
    const { unmount } = render(<Harness />);
    act(() => api.play('s1:0', track));
    await flush();
    unmount();
    expect(provider.log.at(-1)).toBe('dispose');
  });
});
