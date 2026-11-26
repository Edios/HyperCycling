import { describe, expect, it, vi } from 'vitest';
import { bindMediaSession, type MediaSessionLike } from './media-session';

function fakeSession() {
  const handlers = new Map<string, (() => void) | null>();
  const session: MediaSessionLike = {
    playbackState: 'none',
    metadata: null,
    setActionHandler: (action, handler) => {
      handlers.set(action, handler as (() => void) | null);
    },
  };
  return { session, handlers };
}

describe('bindMediaSession (Bluetooth remotes, headphones, the system media controls)', () => {
  it('maps play, pause and next track to the ride, and unbinds them all', () => {
    const { session, handlers } = fakeSession();
    const actions = { play: vi.fn(), pause: vi.fn(), nextSong: vi.fn() };
    const unbind = bindMediaSession(session, actions);
    handlers.get('play')?.();
    handlers.get('pause')?.();
    handlers.get('nexttrack')?.();
    expect(actions.play).toHaveBeenCalledTimes(1);
    expect(actions.pause).toHaveBeenCalledTimes(1);
    expect(actions.nextSong).toHaveBeenCalledTimes(1);
    unbind();
    expect([...handlers.values()].every((h) => h === null)).toBe(true);
  });

  it('leaves out next track when there is no music to skip', () => {
    const { session, handlers } = fakeSession();
    bindMediaSession(session, { play: vi.fn(), pause: vi.fn() });
    expect(handlers.get('nexttrack') ?? null).toBeNull();
  });

  it('survives a browser that refuses an action, or has no media session at all', () => {
    const session: MediaSessionLike = {
      playbackState: 'none',
      metadata: null,
      setActionHandler: (action) => {
        if (action === 'nexttrack') throw new Error('not supported');
      },
    };
    expect(() =>
      bindMediaSession(session, { play: vi.fn(), pause: vi.fn(), nextSong: vi.fn() })(),
    ).not.toThrow();
    expect(() => bindMediaSession(undefined, { play: vi.fn(), pause: vi.fn() })()).not.toThrow();
  });
});
