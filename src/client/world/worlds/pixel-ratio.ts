/** Device pixel ratio capped at 2 (4K projectors and phones do not need more for a backdrop). */
export const maxPixelRatio = (): number => Math.min(window.devicePixelRatio || 1, 2);

/** Calls `onChange` whenever devicePixelRatio changes (window moved to another screen, zoom). */
export function watchDevicePixelRatio(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  let mq: MediaQueryList | undefined;
  const handle = (): void => {
    onChange();
    listen();
  };
  function listen(): void {
    mq?.removeEventListener('change', handle);
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', handle);
  }
  listen();
  return () => mq?.removeEventListener('change', handle);
}
