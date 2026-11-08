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

/** Whether this bike has a stepped resistance knob worth calibrating (S1..S5). */
export function hasKnob(kind: BikeKind): boolean {
  return kind !== 'smart';
}

export const KNOB_STEP_COUNT = 5;
export const KNOB_MAX_POSITION = 99;
/** Knob positions for S1..S5 on a typical ~10-notch scale; the rider adjusts them once. */
export const DEFAULT_KNOB_STEPS: readonly number[] = [1, 3, 5, 7, 9];

/** True when there are exactly five strictly ascending whole positions from 1 to 99. */
export function isValidKnobSteps(steps: readonly number[]): boolean {
  return (
    steps.length === KNOB_STEP_COUNT &&
    steps.every(
      (n, i) =>
        Number.isInteger(n) &&
        n >= 1 &&
        n <= KNOB_MAX_POSITION &&
        (i === 0 || n > (steps[i - 1] ?? 0)),
    )
  );
}

/** Saved calibration when valid, else the defaults. */
export function normalizeKnobSteps(steps: readonly number[] | undefined): readonly number[] {
  return steps && isValidKnobSteps(steps) ? steps : DEFAULT_KNOB_STEPS;
}

export interface KnobHint {
  /** Stopień S1..S5 najbliższy poziomowi wysiłku E1..E10. */
  step: number;
  /** Położenie pokrętła zapisane przez rowerzystę dla tego stopnia. */
  position: number;
}

/**
 * Stopień pokrętła (S1..S5) odpowiadający poziomowi wysiłku E1..E10: skala 1..10 jest
 * rozciągnięta na pięć stopni (E1 = S1, E10 = S5), wynik zaokrąglony do najbliższego stopnia.
 * Zwraca undefined, gdy rower nie ma pokrętła albo rowerzysta nie zapisał poprawnej kalibracji
 * (brak danych lub uszkodzone dane = zachowanie jak przed kalibracją, bez podpowiedzi).
 */
export function knobHint(
  kind: BikeKind,
  knobSteps: readonly number[] | undefined,
  effort: number,
): KnobHint | undefined {
  if (!hasKnob(kind) || !knobSteps || !isValidKnobSteps(knobSteps) || !Number.isFinite(effort)) {
    return undefined;
  }
  const e = Math.min(10, Math.max(1, effort));
  const index = Math.round(((e - 1) / 9) * (KNOB_STEP_COUNT - 1));
  const position = knobSteps[index];
  return position === undefined ? undefined : { step: index + 1, position };
}
