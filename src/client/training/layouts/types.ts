import type { ReactNode } from 'react';
import type { Player } from '../../../domain/player';
import type { Segment } from '../../../domain/segments';
import type { TrainingView } from '../view';

export interface BasicLayoutProps {
  view: TrainingView;
  segments: readonly Segment[];
  players: readonly Player[];
  showsWatts: boolean;
  /** Bike does not measure cadence: the cadence tile shows the target. */
  rpmIsTarget: boolean;
  hideRpmTile: boolean;
  reducedMotion: boolean;
  /** Controls bar, placed by the layout. */
  controls: ReactNode;
  /** Coach cue, rendered in the free centre area. */
  coach: ReactNode;
}
