/** Brand palette (round 9/10). Mirrors the CSS tokens in theme/tokens.css. */

/** Zone colour of each effort 1..10 (index 0 = effort 1). */
export const ZONE_COLORS: readonly string[] = [
  '#8fdcff',
  '#8fdcff',
  '#35d07f',
  '#35d07f',
  '#2f6bff',
  '#2f6bff',
  '#ffd23f',
  '#ff8c2a',
  '#ff4d4d',
  '#ff4d4d',
];

/** Unfilled ring segment (outline) and the solid fill used by marks below 40 px. */
export const UNFILLED = '#28313d';

/** Quiet number colour of the NEXT ring. */
export const QUIET_TEXT = '#b4bcc9';

/** Mode accents. Used only for the tab, the primary button, the mode icon and the selected-row bar. */
export const MODE_ACCENTS = {
  plan: '#84e044',
  free: '#b07dff',
  world: '#f35bd2',
  coach: '#e8dcc0',
} as const;

export type Mode = keyof typeof MODE_ACCENTS;
