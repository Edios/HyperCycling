/** "m:ss", or "h:mm:ss" from one hour up. Seconds are rounded up; negatives and NaN give 0:00. */
export function formatClock(sec: number, opts: { round?: 'ceil' | 'floor' } = {}): string {
  const fn = opts.round === 'floor' ? Math.floor : Math.ceil;
  const total = Number.isFinite(sec) ? Math.max(0, fn(sec)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}
