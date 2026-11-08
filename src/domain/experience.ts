import { z } from 'zod';
import { LANGS, type Lang } from './lang';
import { BPM_MAX, BPM_MIN } from './bpm-match';
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

/** A song suggestion: only names and numbers, never an id (the rider matches it on their own account). */
export interface SongSuggestion {
  artist: string;
  title: string;
  /** Tempo of the song as the author measured it. */
  bpm?: number;
}

/** Preferred recording of a song: the album cut, an extended mix or the radio edit. */
export type SongVersion = 'album' | 'extended' | 'radio';

/**
 * One YouTube upload of a song: the official video, a lyric video or a cover. The first one is
 * played, the rest are the way around a video that will not embed or play on the rider's device.
 */
export interface YoutubeCandidate {
  /** The 11-character video id. */
  id: string;
  /** Short note for the author and the music check, e.g. "official", "lyric video". */
  label?: string;
  /** Where in this upload the song starts, seconds (an intro of the video). Default: the item's offset. */
  offsetSec?: number;
}

/** A song of a slot's authored queue. */
export interface QueueItem extends SongSuggestion {
  /** YouTube uploads of the song, main first; at least two should work (checked by a test). */
  youtube?: YoutubeCandidate[];
  /** Expected length of the preferred version, seconds. */
  durationSec?: number;
  /** Where playback starts (skips an intro), set by the author, seconds. */
  startOffsetSec?: number;
  version?: SongVersion;
}

/** What to look for in one song slot (`slot` = index in the workout's songs). */
export interface MusicHint extends SongSuggestion {
  slot: number;
  /** YouTube uploads of this (first) song, main first. */
  youtube?: YoutubeCandidate[];
  /** Expected length of the preferred version; a shorter song than the slot gets a warning. */
  durationSec?: number;
  /** Beatless piece (cooldown): the tempo is not compared. */
  noBeat?: boolean;
  /** Accept explicit versions (default: prefer the clean one). */
  explicit?: boolean;
  /** Where playback of this (first) song starts, seconds. */
  startOffsetSec?: number;
  version?: SongVersion;
  /** The songs that follow this one in the slot, in order (the authored queue is this + these). */
  queue?: QueueItem[];
  /**
   * The reserve, in order of preference. Never added on top of the queue: it only stands in
   * for a song that is missing from the rider's catalogue or not playable in their region.
   */
  alternatives?: SongSuggestion[];
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
  /** Song suggestions per slot; the rider turns them into pins with their own Spotify. Optional. */
  musicHints?: MusicHint[];
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

const suggestionSchema = z.object({
  artist: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  bpm: z.number().min(BPM_MIN).max(BPM_MAX).optional(),
});

const versionSchema = z.enum(['album', 'extended', 'radio']);

export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const youtubeCandidateSchema = z.object({
  id: z.string().regex(YOUTUBE_ID),
  label: z.string().max(60).optional(),
  offsetSec: z.number().int().min(0).max(600).optional(),
});

const queueItemSchema = suggestionSchema.extend({
  youtube: z.array(youtubeCandidateSchema).max(6).optional(),
  durationSec: z.number().int().min(10).max(1800).optional(),
  startOffsetSec: z.number().int().min(0).max(600).optional(),
  version: versionSchema.optional(),
});

const musicHintSchema = suggestionSchema.extend({
  youtube: z.array(youtubeCandidateSchema).max(6).optional(),
  slot: z.number().int().min(0),
  durationSec: z.number().int().min(10).max(1800).optional(),
  startOffsetSec: z.number().int().min(0).max(600).optional(),
  version: versionSchema.optional(),
  noBeat: z.boolean().optional(),
  explicit: z.boolean().optional(),
  queue: z.array(queueItemSchema).max(8).optional(),
  alternatives: z.array(suggestionSchema).max(5).optional(),
});

const pinTrackSchema = z.object({
  provider: z.enum(['spotify', 'youtube']),
  id: z.string().min(1),
  title: z.string(),
  artist: z.string().optional(),
  durationSec: z.number().min(0).optional(),
  startAtSec: z.number().min(0),
  bpm: z.number().optional(),
  bpmSource: z.enum(['getsongbpm', 'deezer']).optional(),
  notEmbeddable: z.boolean().optional(),
});

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
          track: pinTrackSchema,
          queue: z.array(pinTrackSchema).max(12).optional(),
        }),
      )
      .default([]),
    musicHints: z.array(musicHintSchema).max(32).optional(),
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

const sameSong = (h: SongSuggestion): string =>
  `${h.artist}|${h.title}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9|]+/g, '');

/**
 * Slots whose first suggestion is the same song (a warning, not an error: the author may want it).
 * Each pair is [earlier slot, later slot], 0-based.
 */
export function duplicateHintSlots(e: Experience): [number, number][] {
  const first = new Map<string, number>();
  const out: [number, number][] = [];
  for (const h of [...(e.musicHints ?? [])].sort((a, b) => a.slot - b.slot)) {
    for (const item of hintQueue(h)) {
      const key = sameSong(item);
      const earlier = first.get(key);
      if (earlier === undefined) first.set(key, h.slot);
      else if (earlier !== h.slot) out.push([earlier, h.slot]);
    }
  }
  return out;
}

/** The authored queue of a hint: the song itself, then `queue`. */
export function hintQueue(h: MusicHint): QueueItem[] {
  const { slot: _s, queue, alternatives: _a, noBeat: _n, explicit: _e, ...first } = h;
  void _s;
  void _a;
  void _n;
  void _e;
  return [first, ...(queue ?? [])];
}

export interface HintWarning {
  slot: number;
  kind: 'short' | 'duplicate';
  /** short: seconds missing; duplicate: the earlier slot. */
  value: number;
}

/**
 * Checks for the scenario's author (a test, not shown to riders): the authored queue of each slot
 * should be long enough for the slot (within `toleranceSec`) and no song may repeat between slots.
 * Songs without a duration are not counted; a slot without any known duration is not checked.
 */
export function validateHintQueues(e: Experience, w: Workout, toleranceSec = 10): HintWarning[] {
  const out: HintWarning[] = [];
  for (const h of e.musicHints ?? []) {
    const slot = w.songs?.[h.slot];
    if (!slot) continue;
    const items = hintQueue(h).filter((i) => i.durationSec !== undefined);
    if (items.length === 0) continue;
    const total = items.reduce((t, i) => t + ((i.durationSec ?? 0) - (i.startOffsetSec ?? 0)), 0);
    const missing = songDurationSec(w, slot) - total;
    if (missing > toleranceSec)
      out.push({ slot: h.slot, kind: 'short', value: Math.round(missing) });
  }
  const seen = new Map<string, number>();
  for (const h of [...(e.musicHints ?? [])].sort((a, b) => a.slot - b.slot)) {
    for (const item of hintQueue(h)) {
      const key = sameSong(item);
      const earlier = seen.get(key);
      if (earlier !== undefined && earlier !== h.slot) {
        out.push({ slot: h.slot, kind: 'duplicate', value: earlier });
      } else if (earlier === undefined) seen.set(key, h.slot);
    }
  }
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
  const seen = new Set<number>();
  for (const h of e.musicHints ?? []) {
    if (h.slot >= slots) out.push(`music hint for slot ${h.slot} is past the last song (${slots})`);
    if (seen.has(h.slot)) out.push(`duplicate music hint for slot ${h.slot}`);
    seen.add(h.slot);
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
