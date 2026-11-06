import type { WorldRenderer } from '../world';

/**
 * World registry. Each world is a lazily loaded module implementing WorldRenderer, so three.js
 * (and the world itself) is fetched only when a World session starts. Add new worlds here.
 */
export const WORLDS = {
  'neon-tunnel': async (): Promise<WorldRenderer> =>
    (await import('./neon-tunnel')).createNeonTunnel(),
  road: async (): Promise<WorldRenderer> => (await import('./road')).createRoad(),
  scenes: async (): Promise<WorldRenderer> => (await import('./scenes')).createScenes(),
} satisfies Record<string, () => Promise<WorldRenderer>>;

export type WorldId = keyof typeof WORLDS;
export const DEFAULT_WORLD: WorldId = 'neon-tunnel';
