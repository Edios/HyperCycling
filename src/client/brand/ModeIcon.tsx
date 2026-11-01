import type { Mode } from './palette';

const GLYPH: Record<Mode, string> = {
  plan: 'M3.5 7.5a2.5 2.5 0 0 1 2.5-2.5h12a2.5 2.5 0 0 1 2.5 2.5v11a2 2 0 0 1-2 2H6a2.5 2.5 0 0 1-2.5-2.5zM3.5 10h17M8 3v4M16 3v4',
  free: 'M4 7h9M4 12h16M4 17h11',
  world: 'M3 19 9.5 6M21 19 14.5 6M3 19h18M12 9v2.5M12 14v2',
  coach: 'M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-6l-4 3.5V17H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
};

/** Mode glyph; takes its colour from currentColor (the mode accent). Decorative. */
export function ModeIcon({ mode, size = 18 }: { mode: Mode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={GLYPH[mode]} />
    </svg>
  );
}
