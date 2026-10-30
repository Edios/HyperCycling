import type { CSSProperties } from 'react';

/**
 * Largest font size, in container-width percent (cqw), at which a value of this many characters
 * still fits its tile with padding to spare (Barlow Condensed ExtraBold, tabular digits).
 * The CSS takes min(size cap in vh, this), so short values stay at the cap and long ones shrink.
 */
const FIT_CQW: Record<number, number> = { 1: 80, 2: 60, 3: 52, 4: 50, 5: 40, 6: 34, 7: 30 };

export function fitCqw(chars: number): number {
  if (chars <= 1) return FIT_CQW[1] ?? 80;
  return FIT_CQW[chars] ?? Math.max(8, Math.floor(210 / chars));
}

export type FitStyle = CSSProperties & Record<'--fit', string>;

/** Inline style carrying the fit size for Tile.module.css (`--fit`, read as `--fit * 1cqw`). */
export function fitStyle(chars: number): FitStyle {
  return { '--fit': String(fitCqw(chars)) };
}
