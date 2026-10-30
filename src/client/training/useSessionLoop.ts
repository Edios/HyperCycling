import { useEffect } from 'react';
import { useSessionStore } from './session-store';

/**
 * Drives the engine with requestAnimationFrame while a runtime is loaded. Events are published
 * by the store itself (see `subscribeSessionEvents`), so each one is delivered exactly once.
 */
export function useSessionLoop(): void {
  const loaded = useSessionStore((s) => s.runtime !== undefined);

  useEffect(() => {
    if (!loaded) return;
    let frame = 0;
    const loop = (): void => {
      useSessionStore.getState().tick();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [loaded]);
}
