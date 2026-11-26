/** The part of `navigator.mediaSession` the ride uses (a fake in tests). */
export interface MediaSessionLike {
  playbackState: MediaSessionPlaybackState;
  metadata: MediaMetadata | null;
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
}

export interface MediaSessionActions {
  play(): void;
  pause(): void;
  /** Left out when the ride has no music to skip. */
  nextSong?: (() => void) | undefined;
}

/** The browser's media session, when it has one. */
export function browserMediaSession(): MediaSessionLike | undefined {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
    ? navigator.mediaSession
    : undefined;
}

/**
 * Lets Bluetooth remotes, the play/pause/next buttons of headphones and the system's media
 * controls drive the ride (Media Session API): play, pause, next song. A browser that refuses an
 * action (or has no media session) is no error: the keyboard shortcuts still work. Returns the
 * unbind, which clears every handler it set.
 */
export function bindMediaSession(
  session: MediaSessionLike | undefined,
  actions: MediaSessionActions,
): () => void {
  if (!session) return () => {};
  const set: MediaSessionAction[] = [];
  const bind = (action: MediaSessionAction, run: (() => void) | undefined): void => {
    if (!run) return;
    try {
      session.setActionHandler(action, () => run());
      set.push(action);
    } catch {
      // Not supported by this browser.
    }
  };
  bind('play', actions.play);
  bind('pause', actions.pause);
  bind('nexttrack', actions.nextSong);
  return () => {
    for (const action of set) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // Gone already.
      }
    }
  };
}
