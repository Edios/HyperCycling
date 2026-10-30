import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWakeLock } from './wake-lock';

function fakeNav() {
  const sentinels: { release: ReturnType<typeof vi.fn> }[] = [];
  const request = vi.fn(async () => {
    const s = { release: vi.fn(async () => undefined) };
    sentinels.push(s);
    return s;
  });
  return { nav: { wakeLock: { request } } as unknown as Navigator, request, sentinels };
}

function setVisibility(v: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => setVisibility('visible'));

describe('createWakeLock', () => {
  it('is a no-op when unsupported', async () => {
    const wl = createWakeLock({} as Navigator);
    await expect(wl.acquire()).resolves.toBeUndefined();
    await expect(wl.release()).resolves.toBeUndefined();
  });

  it('acquires once and releases the sentinel', async () => {
    const { nav, request, sentinels } = fakeNav();
    const wl = createWakeLock(nav);
    await wl.acquire();
    await wl.acquire();
    expect(request).toHaveBeenCalledTimes(1);
    await wl.release();
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });

  it('re-acquires when visible again only while held', async () => {
    const { nav, request } = fakeNav();
    const wl = createWakeLock(nav);
    await wl.acquire();
    setVisibility('hidden');
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await wl.release();
    setVisibility('visible');
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('swallows request errors', async () => {
    const nav = {
      wakeLock: {
        request: vi.fn(async () => {
          throw new Error('denied');
        }),
      },
    } as unknown as Navigator;
    await expect(createWakeLock(nav).acquire()).resolves.toBeUndefined();
  });
});
