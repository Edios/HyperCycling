import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_READY_TIMEOUT_MS, YouTubeBackground } from './YouTubeBackground';
import type { YTPlayerEvent, YTPlayerOptions } from './loadIframeApi';

const fake = vi.hoisted(() => ({
  players: [] as {
    opts: { playerVars?: Record<string, string | number>; videoId: string; events?: unknown };
    calls: string[];
  }[],
  reject: false,
}));

vi.mock('./loadIframeApi', () => ({
  loadIframeApi: () =>
    fake.reject
      ? Promise.reject(new Error('blocked'))
      : Promise.resolve({
          Player: class {
            calls: string[] = [];
            constructor(_el: unknown, opts: YTPlayerOptions) {
              fake.players.push({ opts, calls: this.calls });
            }
            playVideo() {
              this.calls.push('play');
            }
            pauseVideo() {
              this.calls.push('pause');
            }
            mute() {
              this.calls.push('mute');
            }
            unMute() {
              this.calls.push('unmute');
            }
            destroy() {
              this.calls.push('destroy');
            }
          },
        }),
}));

const last = () => fake.players[fake.players.length - 1]!;
const events = () =>
  last().opts.events as {
    onReady: (e: YTPlayerEvent) => void;
    onError: (e: YTPlayerEvent) => void;
  };
function target() {
  const p = last();
  return {
    mute: () => p.calls.push('mute'),
    unMute: () => p.calls.push('unmute'),
    playVideo: () => p.calls.push('play'),
    pauseVideo: () => p.calls.push('pause'),
    destroy: () => p.calls.push('destroy'),
  };
}
const flush = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  fake.players.length = 0;
  fake.reject = false;
});
afterEach(() => vi.useRealTimers());

describe('YouTubeBackground', () => {
  it('creates a muted, looping, chrome-less player at the start offset', async () => {
    render(
      <YouTubeBackground videoId="dQw4w9WgXcQ" startSec={90} paused={false} onFail={vi.fn()} />,
    );
    await flush();
    expect(screen.getByTestId('youtube-background')).toBeInTheDocument();
    expect(last().opts.videoId).toBe('dQw4w9WgXcQ');
    expect(last().opts.playerVars).toMatchObject({
      mute: 1,
      loop: 1,
      playlist: 'dQw4w9WgXcQ',
      controls: 0,
      modestbranding: 1,
      playsinline: 1,
      start: 90,
      autoplay: 1,
    });
    act(() => events().onReady({ target: target() }));
    expect(last().calls).toEqual(['mute', 'play']);
  });

  it('follows pause and resume', async () => {
    const { rerender } = render(
      <YouTubeBackground videoId="dQw4w9WgXcQ" paused={false} onFail={vi.fn()} />,
    );
    await flush();
    act(() => events().onReady({ target: target() }));
    last().calls.length = 0;
    rerender(<YouTubeBackground videoId="dQw4w9WgXcQ" paused onFail={vi.fn()} />);
    expect(last().calls).toEqual(['pause']);
    rerender(<YouTubeBackground videoId="dQw4w9WgXcQ" paused={false} onFail={vi.fn()} />);
    expect(last().calls).toEqual(['pause', 'play']);
  });

  it('starts paused when the engine is paused', async () => {
    render(<YouTubeBackground videoId="dQw4w9WgXcQ" paused onFail={vi.fn()} />);
    await flush();
    act(() => events().onReady({ target: target() }));
    expect(last().calls).toEqual(['mute', 'pause']);
  });

  it('destroys the player on unmount', async () => {
    const { unmount } = render(
      <YouTubeBackground videoId="dQw4w9WgXcQ" paused={false} onFail={vi.fn()} />,
    );
    await flush();
    unmount();
    expect(last().calls).toContain('destroy');
  });

  it.each([
    [2, 'unavailable'],
    [5, 'unavailable'],
    [100, 'unavailable'],
    [101, 'embed-blocked'],
    [150, 'embed-blocked'],
  ])('error %i reports %s once', async (code, reason) => {
    const onFail = vi.fn();
    render(<YouTubeBackground videoId="dQw4w9WgXcQ" paused={false} onFail={onFail} />);
    await flush();
    act(() => events().onError({ target: target(), data: code }));
    act(() => events().onError({ target: target(), data: code }));
    expect(onFail).toHaveBeenCalledExactlyOnceWith(reason);
  });

  it('ignores error codes it does not know', async () => {
    const onFail = vi.fn();
    render(<YouTubeBackground videoId="dQw4w9WgXcQ" paused={false} onFail={onFail} />);
    await flush();
    act(() => events().onError({ target: target(), data: 999 }));
    expect(onFail).not.toHaveBeenCalled();
  });

  it('reports a failure when the API cannot load', async () => {
    fake.reject = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onFail = vi.fn();
    render(<YouTubeBackground videoId="dQw4w9WgXcQ" paused={false} onFail={onFail} />);
    await flush();
    expect(onFail).toHaveBeenCalledWith('unavailable');
    warn.mockRestore();
  });

  it('reports a failure when the player never gets ready', async () => {
    vi.useFakeTimers();
    const onFail = vi.fn();
    render(<YouTubeBackground videoId="dQw4w9WgXcQ" paused={false} onFail={onFail} />);
    await flush();
    act(() => void vi.advanceTimersByTime(PLAYER_READY_TIMEOUT_MS));
    expect(onFail).toHaveBeenCalledWith('unavailable');
  });
});
