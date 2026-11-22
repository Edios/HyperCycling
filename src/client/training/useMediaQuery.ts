import { useEffect, useState } from 'react';

function read(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Tracks a CSS media query (the screen turning on its side, a window resized). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
