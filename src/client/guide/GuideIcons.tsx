/** Outline icons for the How it works page and its menu link: 24x24 grid, currentColor, decorative. */
const PATHS = {
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.6a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.8v.1',
  bike: 'M6 18.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM18 18.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM6 15l3.5-7h6l2.5 7M9.5 8l4.5 7M8 6h3M15.5 8L15 5.5h2.5',
  heart: 'M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5M13.5 5l-3 14',
} as const;

export type GuideIconName = keyof typeof PATHS;

export function GuideIcon({ name, size = 18 }: { name: GuideIconName; size?: number }) {
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
      style={{ flex: 'none', verticalAlign: '-0.15em' }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
