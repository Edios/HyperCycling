import { loadIframeApi, type YTNamespace, type YTPlayer } from '../youtube/loadIframeApi';

/** How a trial embed ended. `error` carries the IFrame API error code (101/150 = embedding off). */
export type ProbeResult =
  { kind: 'playing' } | { kind: 'error'; code: number } | { kind: 'timeout' };

export const PROBE_TIMEOUT_MS = 8_000;

export interface ProbeOptions {
  loadApi?: () => Promise<YTNamespace>;
  parent?: HTMLElement;
  timeoutMs?: number;
}

const STATE_PLAYING = 1;

/**
 * Loads `videoId` in a hidden, muted player and reports whether it starts or which error the
 * player gives. It makes no sound (muted before play) and the player is always destroyed again.
 * Only the official IFrame API is used; nothing about the video is touched.
 */
export async function probeYoutube(
  videoId: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const YT = await (options.loadApi ?? (() => loadIframeApi()))();
  const parent = options.parent ?? document.body;
  const frame = document.createElement('div');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:200px;height:200px;opacity:0;pointer-events:none;';
  const target = document.createElement('div');
  frame.appendChild(target);
  parent.appendChild(frame);

  return new Promise<ProbeResult>((resolve) => {
    let player: YTPlayer | undefined;
    let done = false;
    const finish = (result: ProbeResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        player?.pauseVideo();
        player?.destroy();
      } catch (err) {
        console.warn('Stopping the music check player failed', err);
      }
      frame.remove();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ kind: 'timeout' }),
      options.timeoutMs ?? PROBE_TIMEOUT_MS,
    );
    try {
      new YT.Player(target, {
        videoId,
        width: 200,
        height: 200,
        playerVars: { autoplay: 1, mute: 1, controls: 0, playsinline: 1, rel: 0, fs: 0 },
        events: {
          onReady: (e) => {
            player = e.target;
            player.mute(); // before anything plays
            if (done) player.destroy();
          },
          onStateChange: (e) => {
            if (e.data === STATE_PLAYING) finish({ kind: 'playing' });
          },
          onError: (e) => finish({ kind: 'error', code: e.data ?? 0 }),
        },
      });
    } catch {
      finish({ kind: 'timeout' });
    }
  });
}
