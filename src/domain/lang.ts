export const LANGS = ['pl', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/** A user-facing name and description in one language. */
export interface Localized {
  name: string;
  description: string;
  /** Per song-slot hint text (slot id -> text) for class-format workouts. */
  songHints?: Record<string, string>;
}
