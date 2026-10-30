import type { HyperrideWorld } from '../world';

/**
 * World registry. Each world is a lazily loaded module implementing HyperrideWorld, so three.js
 * (and the world itself) is fetched only when a Hyperride session starts. Add new worlds here.
 */
export const WORLDS = {
  'neon-tunnel': async (): Promise<HyperrideWorld> =>
    (await import('./neon-tunnel')).createNeonTunnel(),
} satisfies Record<string, () => Promise<HyperrideWorld>>;

export type WorldId = keyof typeof WORLDS;
export const DEFAULT_WORLD: WorldId = 'neon-tunnel';
