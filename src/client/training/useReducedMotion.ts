import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function read(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

/** Tracks the OS reduced-motion preference. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
