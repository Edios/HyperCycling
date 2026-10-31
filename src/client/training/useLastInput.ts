import { useEffect, useReducer, useRef, useState } from 'react';

/** Re-render at most this often while input keeps arriving (mouse move fires very often). */
const UPDATE_EVERY_MS = 200;

const EVENTS = ['pointermove', 'pointerdown', 'mousemove', 'mousedown', 'touchstart', 'keydown'];

/**
 * Time (performance.now) of the last mouse / touch / key input. It re-renders when input arrives
 * (throttled) and once more `holdMs` after the last input, so a rule that compares it with "now"
 * flips on time even when nothing else on the screen changes.
 */
export function useLastInput(holdMs: number): number {
  const [last, setLast] = useState(() => performance.now());
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const latest = useRef(last);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        setLast(latest.current);
        tick(); // the value may be unchanged; the screen still has to re-evaluate "now"
      }, holdMs);
    };
    const onInput = (): void => {
      const now = performance.now();
      const stale = now - latest.current >= UPDATE_EVERY_MS;
      latest.current = now;
      if (stale) setLast(now);
      arm();
    };
    for (const e of EVENTS) window.addEventListener(e, onInput, { passive: true });
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const e of EVENTS) window.removeEventListener(e, onInput);
    };
  }, [holdMs]);
  return last;
}

/** Monotonic milliseconds; the Focus rule compares it with the last input time. */
export function monotonicNowMs(): number {
  return performance.now();
}
