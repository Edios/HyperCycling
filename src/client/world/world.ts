import type { ThemeId } from '../../domain/experience';
import type { EffortTable } from '../../domain/effort';
import type { Segment } from '../../domain/segments';
import type { EngineState } from '../../domain/session-engine';

export type WorldQuality = 'high' | 'low';

/** Read-only view of the tunnel centre line. All values are in world units along the path. */
export interface PathModel {
  curveX(z: number): number;
  curveY(z: number): number;
  /** Change of curveX over one unit of z, centred on z. */
  slopeX(z: number): number;
  /** Change of curveY over one unit of z, centred on z. */
  slopeY(z: number): number;
}

/** Visual theme of an Experience: which look shows from which workout second. */
export interface WorldTheme {
  id: ThemeId;
  chapters: readonly { startSec: number; look: string }[];
}

/** What the canvas reads from the session every animation frame. */
export interface FrameInput {
  segments: readonly Segment[];
  state: EngineState;
  table: EffortTable;
  /** Set during an Experience; only the Scenes world uses it. Keep the same object between frames. */
  theme?: WorldTheme | undefined;
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
  /** Seconds until the next block starts; null in the last block (or with no workout). */
  nextBlockInSec: number | null;
  /** Current effort mapped to 0..1 (effort / 10). */
  effortGlow: number;
  slopeTarget: number;
  fovTarget: number;
  path: PathModel;
  /** Workout time in seconds (scene schedules are keyed to it). */
  workoutSec: number;
  /** The workout's segments (same array every frame while the workout is unchanged). */
  segments: readonly Segment[];
  /** The Experience theme (same object while it is unchanged), if any. */
  theme?: WorldTheme | undefined;
}

export interface WorldRenderer {
  init(canvas: HTMLCanvasElement, quality: WorldQuality): void;
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
