export interface WakeLockController {
  acquire(): Promise<void>;
  release(): Promise<void>;
}

/**
 * Screen wake lock that is a no-op when unsupported. While "held" it re-acquires the sentinel
 * after the page becomes visible again (browsers drop it when the tab is hidden).
 */
export function createWakeLock(nav: Navigator = navigator): WakeLockController {
  let held = false;
  let sentinel: WakeLockSentinel | null = null;
  let pending = false;

  async function request(): Promise<void> {
    if (!('wakeLock' in nav) || !nav.wakeLock || pending) return;
    pending = true;
    try {
      const s = await nav.wakeLock.request('screen');
      if (!held) {
        await s.release().catch(() => undefined);
        return;
      }
      const previous = sentinel;
      sentinel = s;
      if (previous && previous !== s) await previous.release().catch(() => undefined);
    } catch {
      // Denied or unsupported at runtime: the workout must not be affected.
    } finally {
      pending = false;
    }
  }

  function onVisibility(): void {
    if (held && document.visibilityState === 'visible') void request();
  }

  return {
    async acquire() {
      if (held) return;
      held = true;
      document.addEventListener('visibilitychange', onVisibility);
      await request();
    },
    async release() {
      if (!held) return;
      held = false;
      document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinel;
      sentinel = null;
      if (s) await s.release().catch(() => undefined);
    },
  };
}
