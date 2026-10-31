import type { SessionConfig } from '../../domain/settings';

type Background = SessionConfig['background'];
type Hud = SessionConfig['hud'];

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
