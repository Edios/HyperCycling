/** Ways to switch diagnostics mode on and off from anywhere in the app. */

const ON = new Set(['', '1', 'on', 'true', 'yes']);
const OFF = new Set(['0', 'off', 'false', 'no']);

/** `?diag` (or `?diag=0`) in the address, before or inside the hash route; undefined = not given. */
export function diagParam(search: string, hash: string): boolean | undefined {
  const q = hash.indexOf('?');
  for (const part of [search, q >= 0 ? hash.slice(q) : '']) {
    const value = new URLSearchParams(part).get('diag');
    if (value === null) continue;
    const v = value.toLowerCase();
    if (ON.has(v)) return true;
    if (OFF.has(v)) return false;
  }
  return undefined;
}

/** Ctrl+Shift+D (Cmd+Shift+D on a Mac). */
export const isDiagShortcut = (e: KeyboardEvent): boolean =>
  e.code === 'KeyD' && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey;

/** True on the `count`-th tap within `windowMs` (the phone gesture: tapping the logo). */
export function createTapCounter(count = 5, windowMs = 2000): (now: number) => boolean {
  let taps: number[] = [];
  return (now) => {
    taps = [...taps.filter((t) => now - t < windowMs), now];
    if (taps.length < count) return false;
    taps = [];
    return true;
  };
}
