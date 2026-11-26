import { logoSegments } from './geometry';
import { MARK_SIZE } from './intro-timeline';

/** The placeholder in index.html where the logo's ticks go (the intro and the still logo). */
export const INTRO_TICKS = '<!--INTRO_TICKS-->';

/** The logo's ticks as SVG paths, from the one logo geometry (classes t0-t9 for the intro). */
export function introTicks(): string {
  return logoSegments(MARK_SIZE)
    .map(
      (s, i) =>
        `<path class="t${i}" d="${s.d}" fill="${s.color}" stroke="${s.color}" stroke-width="${s.strokeWidth}" stroke-linejoin="round" />`,
    )
    .join('');
}

/** index.html with every tick placeholder filled (used by vite.config.ts, in dev and builds). */
export function fillIntroTicks(html: string): string {
  return html.replaceAll(INTRO_TICKS, introTicks());
}
