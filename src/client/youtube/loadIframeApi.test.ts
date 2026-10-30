import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IFRAME_API_TIMEOUT_MS,
  IFRAME_API_URL,
  loadIframeApi,
  type IframeApiHost,
  type YTNamespace,
} from './loadIframeApi';

interface FakeScript {
  src: string;
  async: boolean;
  onerror: (() => void) | null;
  remove(): void;
}

function fakeHost() {
  const scripts: FakeScript[] = [];
  const host: IframeApiHost = {
    document: {
      createElement: () => ({
        src: '',
        async: false,
        onerror: null,
        remove() {
          scripts.splice(scripts.indexOf(this as FakeScript), 1);
        },
      }),
      head: { appendChild: (n) => scripts.push(n as FakeScript) },
    },
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  return { host, scripts };
}

const YT = { Player: class {} } as unknown as YTNamespace;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('loadIframeApi', () => {
  it('injects the script once and resolves with YT when the API calls back', async () => {
    const { host, scripts } = fakeHost();
    const a = loadIframeApi(host);
    const b = loadIframeApi(host);
    expect(b).toBe(a);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe(IFRAME_API_URL);
    host.YT = YT;
    host.onYouTubeIframeAPIReady?.();
    await expect(a).resolves.toBe(YT);
  });

  it('resolves immediately when YT is already there, without a script', async () => {
    const { host, scripts } = fakeHost();
    host.YT = YT;
    await expect(loadIframeApi(host)).resolves.toBe(YT);
    expect(scripts).toHaveLength(0);
  });

  it('keeps an existing ready callback working', async () => {
    const { host } = fakeHost();
    const previous = vi.fn();
    host.onYouTubeIframeAPIReady = previous;
    const p = loadIframeApi(host);
    host.YT = YT;
    host.onYouTubeIframeAPIReady?.();
    await p;
    expect(previous).toHaveBeenCalledOnce();
  });

  it('rejects after 10 s and tries again on the next call', async () => {
    const { host, scripts } = fakeHost();
    const p = loadIframeApi(host);
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(IFRAME_API_TIMEOUT_MS);
    expect(await caught).toMatch(/timed out/);
    void loadIframeApi(host).catch(() => undefined);
    // The dead script is gone, so the retry leaves exactly one.
    expect(scripts).toHaveLength(1);
  });

  it('rejects when the API calls back but YT has no Player yet', async () => {
    const { host, scripts } = fakeHost();
    host.YT = {} as unknown as YTNamespace;
    const p = loadIframeApi(host);
    expect(scripts).toHaveLength(1);
    host.onYouTubeIframeAPIReady?.();
    await expect(p).rejects.toThrow(/without a player/);
    expect(scripts).toHaveLength(0);
  });

  it('rejects when the script fails to load', async () => {
    const { host, scripts } = fakeHost();
    const p = loadIframeApi(host);
    scripts[0]?.onerror?.();
    await expect(p).rejects.toThrow(/failed to load/);
    expect(scripts).toHaveLength(0);
  });
});
