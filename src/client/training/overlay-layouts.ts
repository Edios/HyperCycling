import type { SessionConfig } from '../../domain/settings';

export type OverlayHudId = 'immersive' | 'column' | 'cockpit' | 'tunnelTime';

const ALL: readonly OverlayHudId[] = ['immersive', 'column', 'cockpit', 'tunnelTime'];
/** Layouts that have room for the players column. */
const WITH_PLAYERS: readonly OverlayHudId[] = ['immersive', 'column'];

/** Overlay layout for a stored config; anything that is not an overlay layout means Immersive. */
export function initialOverlayHud(hud: SessionConfig['hud']): OverlayHudId {
  return ALL.find((h) => h === hud) ?? 'immersive';
}

export function allowedOverlayHuds(withPlayers: boolean): readonly OverlayHudId[] {
  return withPlayers ? WITH_PLAYERS : ALL;
}

/** The next allowed layout (H); a layout that is not allowed any more falls back to the first. */
export function nextOverlayHud(current: OverlayHudId, withPlayers: boolean): OverlayHudId {
  const list = allowedOverlayHuds(withPlayers);
  const i = list.indexOf(current);
  return list[(i + 1) % list.length] ?? 'immersive';
}

/** Column without players pushes the tunnel to the side of the glass panel. */
export const COLUMN_VIEW_OFFSET = 0.11;
