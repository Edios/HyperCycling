import { UNFILLED, ZONE_COLORS } from './palette';

/** One annular-sector segment of the effort ring, in a 100x100 viewBox. */
export interface RingSegment {
  d: string;
  filled: boolean;
  /** Fill colour for a filled (or solid) segment, undefined for an outlined one. */
  color: string | undefined;
  strokeWidth: number;
}

export interface RingOptions {
  /** Number of filled segments, 0..10. */
  effort: number;
  /** Ring thickness in viewBox units (capped at 11.5 so segments stay elongated rectangles). */
  stroke?: number;
  /** Gap between segments in degrees (capped at 5). */
  gap?: number;
  /** Unfilled segments are drawn solid (marks below 40 px) instead of outlined. */
  solidOff?: boolean;
}

const SEGMENTS = 10;
const START = 135;
const SPAN = 270;

const pt = (r: number, deg: number): string => {
  const a = (deg * Math.PI) / 180;
  return `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
};

/**
 * Geometry of the 10-segment, 270 degree ring shared by the logo mark, the effort ring and the
 * generated brand assets. Segments are annular sectors whose corners are rounded by a same-colour
 * round-joined stroke, so they read as rectangles with a 1-2 px radius, never as pills.
 */
export function ringSegments({
  effort,
  stroke = 10,
  gap = 4,
  solidOff = false,
}: RingOptions): RingSegment[] {
  const th = Math.min(stroke, 11.5);
  const g = Math.min(gap, 5);
  const r = 50 - th / 2 - 1;
  const seg = SPAN / SEGMENTS;
  const out: RingSegment[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const filled = i < effort;
    const pad = filled || solidOff ? 0.8 : 0.75;
    const ro = r + th / 2 - pad;
    const ri = r - th / 2 + pad;
    const da = ((pad / r) * 180) / Math.PI;
    const a0 = START + i * seg + g / 2 + da;
    const a1 = START + (i + 1) * seg - g / 2 - da;
    const d = `M${pt(ro, a0)} A${ro.toFixed(2)} ${ro.toFixed(2)} 0 0 1 ${pt(ro, a1)} L${pt(ri, a1)} A${ri.toFixed(2)} ${ri.toFixed(2)} 0 0 0 ${pt(ri, a0)}Z`;
    out.push({
      d,
      filled,
      color: filled ? ZONE_COLORS[i] : solidOff ? UNFILLED : undefined,
      strokeWidth: filled || solidOff ? pad * 2 : 1.5,
    });
  }
  return out;
}

/** The logo mark's ring: one definition for LogoMark, the intro animation and the brand assets. */
export function logoSegments(size: number): RingSegment[] {
  const small = size < 40;
  return ringSegments({ effort: 10, stroke: small ? 12 : 11, gap: small ? 5 : 4 });
}

/** Centre of tick `i` (0..9) in the 100x100 mark box, and its tangent angle in degrees. */
export function tickCentre(i: number, size: number): { x: number; y: number; angle: number } {
  const stroke = Math.min(size < 40 ? 12 : 11, 11.5);
  const r = 50 - stroke / 2 - 1;
  const angle = START + (i + 0.5) * (SPAN / SEGMENTS);
  const a = (angle * Math.PI) / 180;
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a), angle };
}
