export type Lang = 'pl' | 'en';

/** A user-facing name and description in one language. */
export interface Localized {
  name: string;
  description: string;
}
