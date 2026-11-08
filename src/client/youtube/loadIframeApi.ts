export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

export interface YTPlayerEvent {
  target: YTPlayer;
  data?: number;
}

export interface YTPlayerOptions {
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  /** Embed host; `https://www.youtube-nocookie.com` keeps Google cookies off until playback. */
  host?: string;
  events?: {
    onReady?: (e: YTPlayerEvent) => void;
    onError?: (e: YTPlayerEvent) => void;
    onStateChange?: (e: YTPlayerEvent) => void;
  };
}

export interface YTNamespace {
  Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
}

/** The slice of `window` the loader touches; tests pass a fake. */
export interface IframeApiHost {
  YT?: YTNamespace;
  onYouTubeIframeAPIReady?: () => void;
  document: {
    createElement(tag: 'script'): {
      src: string;
      async: boolean;
      onerror: (() => void) | null;
      remove(): void;
    };
    head: { appendChild(node: unknown): unknown };
  };
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/** Privacy-enhanced embed host used by the music player and the music check. */
export const NOCOOKIE_HOST = 'https://www.youtube-nocookie.com';

export const IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
export const IFRAME_API_TIMEOUT_MS = 10_000;

const pending = new WeakMap<object, Promise<YTNamespace>>();

/**
 * Loads the YouTube IFrame API once per window. A failure (timeout or blocked script) is not
 * cached, so a later call tries again.
 */
export function loadIframeApi(
  host: IframeApiHost = window as unknown as IframeApiHost,
): Promise<YTNamespace> {
  if (host.YT?.Player) return Promise.resolve(host.YT);
  const existing = pending.get(host);
  if (existing) return existing;

  const promise = new Promise<YTNamespace>((resolve, reject) => {
    const script = host.document.createElement('script');
    const previous = host.onYouTubeIframeAPIReady;
    const fail = (message: string): void => {
      host.clearTimeout(timer);
      // Drop the dead script so a retry does not stack a second one next to it.
      script.remove();
      pending.delete(host);
      reject(new Error(message));
    };
    const timer = host.setTimeout(
      () => fail('YouTube IFrame API timed out'),
      IFRAME_API_TIMEOUT_MS,
    );
    host.onYouTubeIframeAPIReady = () => {
      previous?.();
      host.clearTimeout(timer);
      if (host.YT?.Player) resolve(host.YT);
      else fail('YouTube IFrame API loaded without a player');
    };
    script.src = IFRAME_API_URL;
    script.async = true;
    script.onerror = () => fail('YouTube IFrame API failed to load');
    host.document.head.appendChild(script);
  });
  pending.set(host, promise);
  return promise;
}
