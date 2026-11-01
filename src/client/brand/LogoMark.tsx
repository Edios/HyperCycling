import { logoSegments } from './geometry';

export interface LogoMarkProps {
  /** Rendered width and height in px. */
  size?: number;
  /** One colour (currentColor) instead of the zone colours, for single-ink uses. */
  mono?: boolean;
  /** Accessible name; the mark is decorative (aria-hidden) when omitted. */
  title?: string;
  className?: string;
}

/**
 * The HyperCycling mark: an open 270 degree arc of 10 rectangular ticks in zone colours. No digit:
 * the number belongs to the effort ring in the HUD, never to the logo.
 */
export function LogoMark({ size = 28, mono = false, title, className }: LogoMarkProps) {
  const segs = logoSegments(size);
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      data-testid="logo-mark"
      data-mono={mono ? 'true' : undefined}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {segs.map((s, i) => {
        const c = mono ? 'currentColor' : s.color;
        return (
          <path
            key={i}
            d={s.d}
            fill={c}
            stroke={c}
            strokeWidth={s.strokeWidth}
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}
