import { flattenWorkout } from '../../domain/segments';
import { songDurationSec, type SongSlot, type Workout } from '../../domain/workout';
import type { EffortTable } from '../../domain/effort';
import { EXPERIENCE_LEVELS, type Experience, type ExperienceLevel } from '../../domain/experience';
import { intensityEffort } from '../editor/model';

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

export interface ScenarioRow {
  id: string;
  time: string;
  /** Visual chapter (look id) in force during this slot. */
  look?: string;
  /** Suggested song for the slot, when the experience names one. */
  title?: string;
  artist?: string;
  /** Lowest and highest effort level (1..10) in the slot. */
  minEffort: number;
  maxEffort: number;
}

/** Lowest and highest effort level of the top-level blocks of a slot (repeats expanded once). */
export function slotEffortRange(
  w: Workout,
  song: SongSlot,
  table: EffortTable,
): { min: number; max: number } {
  const a = w.blocks.findIndex((b) => b.id === song.firstBlockId);
  const z = w.blocks.findIndex((b) => b.id === song.lastBlockId);
  let min = Infinity;
  let max = -Infinity;
  const take = (n: number): void => {
    min = Math.min(min, n);
    max = Math.max(max, n);
  };
  if (a >= 0 && z >= a) {
    for (const b of w.blocks.slice(a, z + 1)) {
      for (const leaf of b.kind === 'repeat' ? b.blocks : [b]) {
        if (leaf.kind === 'steady') take(intensityEffort(leaf.intensity, table));
        else {
          take(intensityEffort(leaf.from, table));
          take(intensityEffort(leaf.to, table));
        }
      }
    }
  }
  return min === Infinity ? { min: 0, max: 0 } : { min, max };
}

/** Song slots of the experience: length as m:ss, chapter, suggested song and effort range. */
export function scenarioRows(w: Workout, e: Experience, table: EffortTable): ScenarioRow[] {
  const chapters = e.worldTheme.chapters ?? [];
  return (w.songs ?? []).map((s, i) => {
    const hint = e.musicHints?.find((h) => h.slot === i);
    const { min, max } = slotEffortRange(w, s, table);
    return {
      id: s.id,
      time: formatSongTime(songDurationSec(w, s)),
      look: chapters.filter((c) => c.atPin <= i).at(-1)?.look,
      title: hint?.title,
      artist: hint?.artist,
      minEffort: min,
      maxEffort: max,
    };
  });
}

/** Lowest and highest effort (1-10) of the ride, for the card; undefined for an empty workout. */
export function effortRange(
  w: Workout,
  table?: EffortTable,
): { min: number; max: number } | undefined {
  const efforts = flattenWorkout(w, table).flatMap((s) => [s.effortStart, s.effortEnd]);
  return efforts.length > 0 ? { min: Math.min(...efforts), max: Math.max(...efforts) } : undefined;
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

/** Rides of one world shown as a single card: the variants differ in length and difficulty. */
export interface ExperienceSeries {
  /** Theme id for a series; the experience id for a ride that stands alone. */
  key: string;
  /** The theme the variants share; undefined for a ride on its own. */
  theme?: Experience['worldTheme']['theme'];
  /** Shortest first, easier before harder at the same length. */
  variants: Experience[];
}

/**
 * Groups the catalogue by world. The abstract look is no world to speak of, so each of those
 * rides stays its own card; the order of the first appearance is kept.
 */
export function groupSeries(list: readonly Experience[]): ExperienceSeries[] {
  const out: ExperienceSeries[] = [];
  const byTheme = new Map<string, ExperienceSeries>();
  for (const e of list) {
    const theme = e.worldTheme.theme;
    if (theme === 'abstract') {
      out.push({ key: e.id, variants: [e] });
      continue;
    }
    let group = byTheme.get(theme);
    if (!group) {
      group = { key: theme, theme, variants: [] };
      byTheme.set(theme, group);
      out.push(group);
    }
    group.variants.push(e);
  }
  const rank = (l: ExperienceLevel): number => EXPERIENCE_LEVELS.indexOf(l);
  for (const g of out) {
    g.variants.sort((a, b) => a.lengthMin - b.lengthMin || rank(a.level) - rank(b.level));
  }
  return out;
}

/**
 * Short name of a variant inside its series: the title without the series name ("Neon Grid Light
 * 45" -> "Light 45"); a bare number gets "min" ("Neon Grid 30" -> "30 min"). A title that does not
 * start with the series name is kept whole.
 */
export function variantLabel(title: string, seriesTitle: string, minLabel = 'min'): string {
  const rest = title.startsWith(seriesTitle) ? title.slice(seriesTitle.length).trim() : title;
  if (rest === '') return title;
  return /^\d+$/.test(rest) ? `${rest} ${minLabel}` : rest;
}

/** The variant to open on: the first that fits the level filter, else the first. */
export function defaultVariant(series: ExperienceSeries, f: LevelFilter): Experience {
  return series.variants.find((e) => matchesLevel(e, f)) ?? series.variants[0]!;
}
