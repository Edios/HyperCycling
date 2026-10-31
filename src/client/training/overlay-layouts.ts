import type { SessionConfig } from '../../domain/settings';

type Background = SessionConfig['background'];
type Hud = SessionConfig['hud'];

/** Overlay layouts (any background). Stored ids stay as they were; only the labels changed. */
export type OverlayHudId = 'immersive' | 'column' | 'cockpit' | 'tunnelTime' | 'focus';

/** 'classic' is the tiled Basic screen (stored as solo / players); it needs the plain background. */
export type LayoutKind = 'classic' | OverlayHudId;

const OVERLAYS: readonly OverlayHudId[] = ['immersive', 'column', 'cockpit', 'tunnelTime', 'focus'];

/** Cockpit and Minimal have no room for the riders panel. */
const WITHOUT_RIDERS: readonly LayoutKind[] = ['cockpit', 'tunnelTime'];

export function supportsRiders(kind: LayoutKind): boolean {
  return !WITHOUT_RIDERS.includes(kind);
}

/** The layout for a stored id on a background; Basic's own tiles exist only on Basic. */
export function layoutKindOf(hud: Hud, background: Background): LayoutKind {
  const overlay = OVERLAYS.find((h) => h === hud);
  if (overlay) return overlay;
  return background === 'basic' ? 'classic' : 'immersive';
}

/** Layouts the rider may pick (and H cycles through) for a background. */
export function layoutChoices(background: Background): readonly LayoutKind[] {
  return background === 'basic' ? ['classic', ...OVERLAYS] : OVERLAYS;
}

/** The next layout (H); one that is not offered on this background falls back to the first. */
export function nextLayout(current: LayoutKind, background: Background): LayoutKind {
  const list = layoutChoices(background);
  const i = list.indexOf(current);
  return list[(i + 1) % list.length] ?? 'immersive';
}

/** The stored layout id for what is on screen. */
export function storedHud(kind: LayoutKind, ridersShown: boolean): Hud {
  if (kind === 'classic') return ridersShown ? 'players' : 'solo';
  return kind;
}

/** Column without players pushes the tunnel to the side of the glass panel. */
export const COLUMN_VIEW_OFFSET = 0.11;
