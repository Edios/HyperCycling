import { useEffect, useState } from 'react';

/** True after `ms` without mouse or key activity; any activity shows it again. */
export function useIdleHide(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), ms);
    const wake = (): void => {
      clearTimeout(timer);
      setIdle(false);
      timer = setTimeout(() => setIdle(true), ms);
    };
    window.addEventListener('mousemove', wake);
    window.addEventListener('mousedown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('mousedown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [ms]);
  return idle;
}
