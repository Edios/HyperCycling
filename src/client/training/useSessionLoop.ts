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
      frame = requestAnimationFrame(loop); // schedule first: a failing tick must not stop the loop
      try {
        useSessionStore.getState().tick();
      } catch (err) {
        console.error('Session tick failed', err);
      }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [loaded]);
}
