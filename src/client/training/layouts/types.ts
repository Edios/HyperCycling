import type { ReactNode } from 'react';
import type { Player } from '../../../domain/player';
import type { Segment } from '../../../domain/segments';
import type { TrainingView } from '../view';

export interface BasicLayoutProps {
  view: TrainingView;
  segments: readonly Segment[];
  players: readonly Player[];
  showsWatts: boolean;
  /** Bike does not measure cadence: the cadence row shows the plan's target. */
  rpmIsTarget: boolean;
  hideRpmTile: boolean;
  reducedMotion: boolean;
  /** A background (World, YouTube) is behind the HUD: glass panels instead of solid ones. */
  glass: boolean;
  /** Workout name for the floor caption. */
  workoutName: string;
  /** Controls bar, placed by the layout. */
  controls: ReactNode;
  /** Coach cue, rendered in the free centre area. */
  coach: ReactNode;
}
