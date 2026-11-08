import { afterEach, describe, expect, it, vi } from 'vitest';
import type { YTNamespace, YTPlayerEvent, YTPlayerOptions } from '../youtube/loadIframeApi';
import { probeYoutube } from './youtube-probe';

type Script = (events: NonNullable<YTPlayerOptions['events']>, target: object) => void;

function apiWith(script: Script, seen: YTPlayerOptions[] = []): () => Promise<YTNamespace> {
  const calls: string[] = [];
  return () =>
    Promise.resolve({
      Player: class {
        constructor(el: HTMLElement, opts: YTPlayerOptions) {
          seen.push(opts);
          const self = {
            mute: () => calls.push('mute'),
            unMute: () => undefined,
            playVideo: () => undefined,
            pauseVideo: () => undefined,
            destroy: () => calls.push('destroy'),
          };
          el.replaceWith(document.createElement('iframe'));
          queueMicrotask(() => script(opts.events ?? {}, self));
        }
      } as unknown as YTNamespace['Player'],
    });
}

const ev = (target: object, data?: number): YTPlayerEvent =>
  ({ target, ...(data !== undefined ? { data } : {}) }) as YTPlayerEvent;

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('probeYoutube', () => {
  it('reports playing, asks for a muted privacy-enhanced embed and cleans up', async () => {
    const seen: YTPlayerOptions[] = [];
    const result = await probeYoutube('abc', {
      loadApi: apiWith((e, t) => {
        e.onReady?.(ev(t));
        e.onStateChange?.(ev(t, 1));
      }, seen),
    });
    expect(result).toEqual({ kind: 'playing' });
    expect(seen[0]?.playerVars).toMatchObject({ mute: 1, autoplay: 1 });
    expect(seen[0]?.host).toBe('https://www.youtube-nocookie.com');
    expect(document.body.querySelector('div[aria-hidden="true"]')).toBeNull();
  });

  it('reports the player error code', async () => {
    const result = await probeYoutube('abc', {
      loadApi: apiWith((e, t) => e.onError?.(ev(t, 150))),
    });
    expect(result).toEqual({ kind: 'error', code: 150 });
  });

  it('times out when the video never starts', async () => {
    vi.useFakeTimers();
    const pending = probeYoutube('abc', { loadApi: apiWith(() => undefined), timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toEqual({ kind: 'timeout' });
  });
});
