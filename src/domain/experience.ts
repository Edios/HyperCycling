import { z } from 'zod';
import { LANGS, type Lang } from './lang';
import { songDurationSec, type MusicCue, type Workout } from './workout';

/**
 * Experience: a ready-made ride = a workout (class-style scenario) + music pins + a world theme +
 * catalogue metadata. The workout stays the only source of truth about effort; the theme only
 * changes what is seen. Design: docs/superpowers/specs/2026-11-07-experience-design.md (git-ignored).
 */

export const THEME_IDS = ['abstract', 'neon-grid'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const EXPERIENCE_LEVELS = ['easy', 'medium', 'hard'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const EXPERIENCE_BIKES = ['manual-stepped', 'trainer', 'power'] as const;
export type ExperienceBike = (typeof EXPERIENCE_BIKES)[number];

/** A visual chapter starts with the song (slot) at index `atPin` and lasts until the next one. */
export interface ThemeChapter {
  atPin: number;
  look: string;
}

export interface WorldTheme {
  theme: ThemeId;
  chapters?: ThemeChapter[];
}

export interface ExperienceText {
  title: string;
  description: string;
}

export interface Experience {
  id: string;
  title: string;
  /** One sentence promise. */
  description: string;
  localized?: Partial<Record<Lang, ExperienceText>>;
  workoutRef: { kind: 'builtin' | 'user'; id: string };
  /** Pins of the experience; they override the workout's own music cues. May be empty. */
  musicPins: MusicCue[];
  worldTheme: WorldTheme;
  /** Fixed route; absent = a new seed per session. */
  seed?: number;
  lengthMin: 30 | 45 | 60;
  level: ExperienceLevel;
  bike: ExperienceBike;
  /** How many resistance steps the scenario assumes. */
  stepCount: number;
  tags: string[];
  schemaVersion: 1;
  updatedAt: string;
}

const knownTheme = (v: unknown): unknown =>
  typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v) ? v : 'abstract';

export const experienceSchema: z.ZodType<Experience> = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    localized: z
      .object(
        Object.fromEntries(
          LANGS.map((l) => [l, z.object({ title: z.string().min(1), description: z.string() })]),
        ),
      )
      .partial()
      .optional(),
    workoutRef: z.object({ kind: z.enum(['builtin', 'user']), id: z.string().min(1) }),
    musicPins: z
      .array(
        z.object({
          blockId: z.string().min(1),
          rep: z.number().int().min(1),
          track: z.object({
            provider: z.enum(['spotify', 'youtube']),
            id: z.string().min(1),
            title: z.string(),
            artist: z.string().optional(),
            durationSec: z.number().min(0).optional(),
            startAtSec: z.number().min(0),
            bpm: z.number().optional(),
            bpmSource: z.literal('getsongbpm').optional(),
            notEmbeddable: z.boolean().optional(),
          }),
        }),
      )
      .default([]),
    worldTheme: z.object({
      // an unknown theme (newer file, older app) falls back to the abstract look
      theme: z.preprocess(knownTheme, z.enum(THEME_IDS)),
      chapters: z
        .array(z.object({ atPin: z.number().int().min(0), look: z.string().min(1) }))
        .max(32)
        .optional(),
    }),
    seed: z.number().int().min(0).optional(),
    lengthMin: z.union([z.literal(30), z.literal(45), z.literal(60)]),
    level: z.enum(EXPERIENCE_LEVELS),
    bike: z.enum(EXPERIENCE_BIKES),
    stepCount: z.number().int().min(2).max(12),
    tags: z.array(z.string()).max(12),
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (e) => {
      const c = e.worldTheme.chapters ?? [];
      return c.every((x, i) => i === 0 || x.atPin > (c[i - 1]?.atPin ?? -1));
    },
    { message: 'chapters must be sorted by atPin and unique', path: ['worldTheme', 'chapters'] },
  ) as unknown as z.ZodType<Experience>;

/** Display text in the language, falling back to the English default. */
export function experienceText(e: Experience, lang: Lang): ExperienceText {
  return e.localized?.[lang] ?? { title: e.title, description: e.description };
}

/** Start second of every song slot of a class-format workout (slot index = pin index). */
export function songStartsSec(w: Workout): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const s of w.songs ?? []) {
    starts.push(t);
    t += songDurationSec(w, s);
  }
  return starts;
}

export interface ResolvedChapter {
  startSec: number;
  look: string;
}

/**
 * Chapters resolved to workout seconds: `atPin` is the index of the song slot where the chapter
 * begins. Chapters pointing past the last song are dropped (the workout changed). The first one
 * always begins at 0 so the theme has a look from the start.
 */
export function resolveChapters(e: Experience, w: Workout): ResolvedChapter[] {
  const starts = songStartsSec(w);
  const out: ResolvedChapter[] = [];
  for (const c of e.worldTheme.chapters ?? []) {
    const startSec = starts[c.atPin];
    if (startSec === undefined) continue;
    out.push({ startSec, look: c.look });
  }
  const first = out[0];
  if (first && first.startSec > 0) out.unshift({ startSec: 0, look: first.look });
  return out;
}

/** Problems that make an experience unusable with this workout (empty = fine). */
export function experienceProblems(e: Experience, w: Workout): string[] {
  const out: string[] = [];
  const slots = w.songs?.length ?? 0;
  if (w.format !== 'songs' || slots === 0) out.push('workout has no song slots');
  const ids = new Set(
    w.blocks.flatMap((b) => [b.id, ...(b.kind === 'repeat' ? b.blocks.map((x) => x.id) : [])]),
  );
  for (const c of e.worldTheme.chapters ?? []) {
    if (c.atPin >= slots) out.push(`chapter at pin ${c.atPin} is past the last song (${slots})`);
  }
  for (const p of e.musicPins)
    if (!ids.has(p.blockId)) out.push(`pin for unknown block ${p.blockId}`);
  const mins = Math.round(
    w.blocks.length === 0 ? 0 : (w.songs ?? []).reduce((s, x) => s + songDurationSec(w, x), 0) / 60,
  );
  if (slots > 0 && Math.abs(mins - e.lengthMin) > Math.max(3, e.lengthMin * 0.1)) {
    out.push(`length ${e.lengthMin} min differs from the workout (${mins} min)`);
  }
  return out;
}

/** Workout with the experience's own music pins on top of its cues (pins win per block+rep). */
export function withExperiencePins(w: Workout, e: Experience): Workout {
  if (e.musicPins.length === 0) return w;
  const key = (c: MusicCue): string => `${c.blockId}#${c.rep}`;
  const pinned = new Set(e.musicPins.map(key));
  return {
    ...w,
    musicCues: [...w.musicCues.filter((c) => !pinned.has(key(c))), ...e.musicPins],
  };
}
