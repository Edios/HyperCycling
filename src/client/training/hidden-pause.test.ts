import { describe, expect, it, vi } from 'vitest';
import { hiddenPauseAction, isMobileDevice, watchPageHidden } from './hidden-pause';

describe('hiddenPauseAction', () => {
  it('pauses a running ride on a phone', () => {
    expect(hiddenPauseAction({ mobile: true, status: 'running', trainerAutoPaused: false })).toBe(
      'pause',
    );
  });

  it('does nothing on a computer (PC keeps riding with the tab in the background)', () => {
    expect(hiddenPauseAction({ mobile: false, status: 'running', trainerAutoPaused: false })).toBe(
      'none',
    );
    expect(hiddenPauseAction({ mobile: false, status: 'paused', trainerAutoPaused: true })).toBe(
      'none',
    );
  });

  it('leaves idle, countdown, finished and a pause made by the rider alone', () => {
    for (const status of ['idle', 'countdown', 'finished', 'paused'] as const) {
      expect(hiddenPauseAction({ mobile: true, status, trainerAutoPaused: false })).toBe('none');
    }
  });

  it('takes over a trainer auto-pause, so the ride resumes only from a tap', () => {
    expect(hiddenPauseAction({ mobile: true, status: 'paused', trainerAutoPaused: true })).toBe(
      'takeOver',
    );
  });
});

function fakeTarget() {
  const handlers = new Map<string, Set<() => void>>();
  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: vi.fn((type: string, h: () => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)?.add(h);
    }),
    removeEventListener: vi.fn((type: string, h: () => void) => {
      handlers.get(type)?.delete(h);
    }),
    fire(type: string) {
      for (const h of handlers.get(type) ?? []) h();
    },
    count(type: string) {
      return handlers.get(type)?.size ?? 0;
    },
  };
}

describe('watchPageHidden', () => {
  it('calls back when the page becomes hidden and on pagehide, not when it becomes visible', () => {
    const doc = fakeTarget();
    const win = fakeTarget();
    const onHidden = vi.fn();
    const off = watchPageHidden(doc, win, onHidden);

    doc.fire('visibilitychange'); // still visible
    expect(onHidden).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(onHidden).toHaveBeenCalledTimes(1);
    win.fire('pagehide');
    expect(onHidden).toHaveBeenCalledTimes(2);

    off();
    expect(doc.count('visibilitychange')).toBe(0);
    expect(win.count('pagehide')).toBe(0);
  });
});

describe('isMobileDevice', () => {
  const env = (coarse: boolean, mobileHint?: boolean) => ({
    matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' && coarse }),
    navigator: mobileHint === undefined ? {} : { userAgentData: { mobile: mobileHint } },
  });

  it('is true for a touch-first device or a browser that says it is mobile', () => {
    expect(isMobileDevice(env(true))).toBe(true);
    expect(isMobileDevice(env(false, true))).toBe(true);
  });

  it('is false for a mouse-first computer', () => {
    expect(isMobileDevice(env(false))).toBe(false);
    expect(isMobileDevice(env(false, false))).toBe(false);
    expect(isMobileDevice({ navigator: {} })).toBe(false);
  });
});
