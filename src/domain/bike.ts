import type { Equipment, ResistanceMode } from './settings';

/** What the rider sits on; the setup step maps it onto the existing equipment settings. */
export const BIKE_KINDS = ['knob', 'knobPower', 'smart'] as const;
export type BikeKind = (typeof BIKE_KINDS)[number];

export interface BikePreset {
  resistanceMode: ResistanceMode;
  showsWatts: boolean;
}

/** Manual knob: no watts. Spin bike with a meter: knob + power hint. Smart trainer: smooth ramps. */
export function bikePreset(kind: BikeKind): BikePreset {
  switch (kind) {
    case 'knob':
      return { resistanceMode: 'knob', showsWatts: false };
    case 'knobPower':
      return { resistanceMode: 'knobPower', showsWatts: true };
    case 'smart':
      return { resistanceMode: 'smart', showsWatts: true };
  }
}

/** Inverse of {@link bikePreset} for showing the current choice; knob without a mode reads as smart. */
export function bikeKindOf(mode: ResistanceMode, eq: Pick<Equipment, 'showsWatts'>): BikeKind {
  if (mode === 'smart') return 'smart';
  if (mode === 'knobPower') return 'knobPower';
  return eq.showsWatts ? 'knobPower' : 'knob';
}

/**
 * Whether the bike counts as one that shows watts: the switch in Settings, or a Bluetooth trainer
 * that is connected (it measures power whatever the switch says). One answer for the setup and
 * the whole ride, so a fresh profile with a trainer rides in trainer mode.
 */
export function bikeShowsWatts(eq: Pick<Equipment, 'showsWatts'>, trainerPresent: boolean): boolean {
  return eq.showsWatts || trainerPresent;
}

/** Whether this bike has a manual resistance knob (no per-rider calibration; effort is 1-10). */
export function hasKnob(kind: BikeKind): boolean {
  return kind !== 'smart';
}
