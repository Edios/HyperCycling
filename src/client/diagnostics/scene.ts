/**
 * What the training screen draws behind the HUD, for the global Diagnostics overlay. Published
 * by the training screen only while diagnostics mode is on; null elsewhere.
 */
export interface DiagScene {
  /** e.g. "World / road" or "Basic". */
  scene: string;
  /** Effective World quality; undefined when no canvas is running. */
  quality?: string | undefined;
}

let current: DiagScene | null = null;

export const publishDiagScene = (scene: DiagScene | null): void => {
  current = scene;
};
export const readDiagScene = (): DiagScene | null => current;
