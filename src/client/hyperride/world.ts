import type { EffortTable } from '../../domain/effort';
import type { Segment } from '../../domain/segments';
import type { EngineState } from '../../domain/session-engine';

export type HyperrideQuality = 'high' | 'low';

/** Read-only view of the tunnel centre line. All values are in world units along the path. */
export interface PathModel {
  curveX(z: number): number;
  curveY(z: number): number;
  /** Change of curveX over one unit of z, centred on z. */
  slopeX(z: number): number;
  /** Change of curveY over one unit of z, centred on z. */
  slopeY(z: number): number;
}

/** What the canvas reads from the session every animation frame. */
export interface FrameInput {
  segments: readonly Segment[];
  state: EngineState;
  table: EffortTable;
}

/** Everything a world needs for one frame. Targets are smoothed by the world itself. */
export interface WorldFrame {
  /** Seconds since the previous frame, clamped to 0.1. */
  dtSec: number;
  speedTarget: number;
  /** Zone color of the current effort (streaks). */
  effortColor: string;
  /** Zone color of the block that will be active when the camera reaches `depth`. */
  colorAtDepth(depth: number): string;
  /** Current effort mapped to 0..1 (effort / 10). */
  effortGlow: number;
  slopeTarget: number;
  fovTarget: number;
  path: PathModel;
}

export interface HyperrideWorld {
  init(canvas: HTMLCanvasElement, quality: HyperrideQuality): void;
  update(frame: WorldFrame): void;
  resize(width: number, height: number): void;
  /** Horizontal view offset as a fraction of the width (Column HUD without players: 0.11). */
  setViewOffsetX(fraction: number): void;
  /** Current (smoothed) speed in units per second. */
  readonly speed: number;
  /** Distance travelled along the path. */
  readonly distance: number;
  dispose(): void;
}
