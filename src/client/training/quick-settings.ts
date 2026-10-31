import type { SessionConfig } from '../../domain/settings';
import { allowedOverlayHuds, type OverlayHudId } from './overlay-layouts';

type Background = SessionConfig['background'];
type Hud = SessionConfig['hud'];

/** Layouts the rider may pick for the chosen background (Hyperride and YouTube share theirs). */
export function hudChoices(
  background: Background,
  hasPlayers: boolean,
  playersShown: boolean,
): Hud[] {
  if (background === 'basic') return hasPlayers ? ['solo', 'players'] : ['solo'];
  return [...allowedOverlayHuds(playersShown && hasPlayers)];
}

/** The layout id to store for what is on screen right now. */
export function activeHud(
  background: Background,
  playersShown: boolean,
  overlayHud: OverlayHudId,
): Hud {
  if (background === 'basic') return playersShown ? 'players' : 'solo';
  return overlayHud;
}

/** The link the YouTube background would play: the session's own, else the latest recent one. */
export function youtubeUrlFor(
  sessionUrl: string | undefined,
  recent: readonly string[],
): string | undefined {
  return sessionUrl ?? recent[0];
}

/** The config after a live change; the YouTube link only travels with the YouTube background. */
export function withLiveChoice(
  config: SessionConfig,
  background: Background,
  hud: Hud,
  youtubeUrl: string | undefined,
): SessionConfig {
  const rest: SessionConfig = { ...config, background, hud };
  delete rest.youtubeUrl;
  if (background === 'youtube' && youtubeUrl) rest.youtubeUrl = youtubeUrl;
  return rest;
}
