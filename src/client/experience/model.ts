import { songDurationSec, type Workout } from '../../domain/workout';
import type { Experience, ExperienceLevel } from '../../domain/experience';

export type LevelFilter = 'all' | ExperienceLevel;

export function matchesLevel(e: Experience, f: LevelFilter): boolean {
  return f === 'all' || e.level === f;
}

/** Song slots of the experience's workout with their length in minutes (rounded, at least 1). */
export function scenarioRows(w: Workout): { id: string; minutes: number }[] {
  return (w.songs ?? []).map((s) => ({
    id: s.id,
    minutes: Math.max(1, Math.round(songDurationSec(w, s) / 60)),
  }));
}

/** The experience to feature on the start page: the first by id. */
export function featuredExperience(list: readonly Experience[]): Experience | undefined {
  return [...list].sort((a, b) => a.id.localeCompare(b.id))[0];
}
