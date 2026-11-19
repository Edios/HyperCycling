/** Small inline icon set: outline, 24x24 grid, currentColor. Decorative unless a `label` is given. */
const PATHS = {
  edit: 'M4 20l4-1 11-11-3-3L5 16z',
  players:
    'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6M17.5 11.5a2.5 2.5 0 1 0 0-5M17 14c2.5 0 4 1.5 4.5 5',
  // A gear: toothed outline plus the hub (the old sun read as "brightness", not "settings").
  settings:
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  prev: 'M6 5v14M18 5L9 12l9 7z',
  next: 'M18 5v14M6 5l9 7-9 7z',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  volume: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 9.5l5 5M21 9.5l-5 5',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  music:
    'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  warning: 'M12 4L2.5 20h19zM12 10v4.5M12 17.2v.1',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  undo: 'M9 6L4 11l5 5M4 11h10a6 6 0 0 1 0 12',
  redo: 'M15 6l5 5-5 5M20 11H10a6 6 0 0 0 0 12',
  trendUp: 'M4 17l6-6 4 4 6-8M15 7h5v5',
  trendDown: 'M4 7l6 6 4-4 6 8M15 17h5v-5',
  steady: 'M4 12h16',
  repeat: 'M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4',
  ramp: 'M4 19L20 5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M6 9l6 6 6-6',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.4 9.6a2.7 2.7 0 1 1 3.9 2.4c-.8.5-1.3 1-1.3 1.9M12 17.1v.1',
  layout:
    'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM3 11h18M12 11v10',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  label,
}: {
  name: IconName;
  /** Pixels, or a CSS length such as `1em` to follow the font size of the parent. */
  size?: number | string;
  /** Accessible name; omit for decorative icons (they are then aria-hidden). */
  label?: string;
}) {
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
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      style={{ flex: 'none', verticalAlign: '-0.15em' }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
