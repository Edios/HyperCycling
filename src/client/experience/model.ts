import { songDurationSec, type Workout } from '../../domain/workout';
import type { Experience, ExperienceLevel } from '../../domain/experience';

export type LevelFilter = 'all' | ExperienceLevel;

export function matchesLevel(e: Experience, f: LevelFilter): boolean {
  return f === 'all' || e.level === f;
}

/** m:ss, so the rows add up to the class length (no rounding to whole minutes). */
export function formatSongTime(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const s = total % 60;
  return `${Math.floor(total / 60)}:${s < 10 ? '0' : ''}${s}`;
}

/** Song slots of the experience's workout with their length as m:ss. */
export function scenarioRows(w: Workout): { id: string; time: string }[] {
  return (w.songs ?? []).map((s) => ({ id: s.id, time: formatSongTime(songDurationSec(w, s)) }));
}

/** The experience to feature on the start page: the longest one; a tie goes to the first by id (explicit, not by accident). */
export function featuredExperience(list: readonly Experience[]): Experience | undefined {
  let best: Experience | undefined;
  for (const e of list) {
    if (
      !best ||
      e.lengthMin > best.lengthMin ||
      (e.lengthMin === best.lengthMin && e.id.localeCompare(best.id) < 0)
    )
      best = e;
  }
  return best;
}
