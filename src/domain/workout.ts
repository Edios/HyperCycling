import { z } from 'zod';
import { effortLevelSchema, type EffortLevel } from './effort';
import { LANGS, type Lang, type Localized } from './lang';
import { newId } from './ids';
import { BPM_MAX, BPM_MIN } from './bpm-match';

export type Position = 'seated' | 'standing';

export interface Intensity {
  effort?: EffortLevel;
  ftpPct?: number;
} // at least one required

export interface SteadyBlock {
  kind: 'steady';
  id: string;
  durationSec: number;
  intensity: Intensity;
  rpm?: number;
  position?: Position;
  cue?: string;
  label?: string;
}

export interface RampBlock {
  kind: 'ramp';
  id: string;
  durationSec: number;
  from: Intensity;
  to: Intensity;
  /** Step override for stepped effort: absent/0 = auto, 1 = hold the mean, 2..8 = exactly that many. */
  steps?: number;
  rpm?: number;
  position?: Position;
  cue?: string;
  label?: string;
}

export interface RepeatBlock {
  kind: 'repeat';
  id: string;
  times: number;
  blocks: (SteadyBlock | RampBlock)[];
} // times 2..50, blocks >= 1

export type Block = SteadyBlock | RampBlock | RepeatBlock;

export interface TrackRef {
  provider: 'spotify' | 'youtube';
  id: string;
  title: string;
  artist?: string;
  durationSec?: number;
  startAtSec: number;
  /** Tempo typed or tapped by the user (no audio analysis); used to match the block's RPM. */
  bpm?: number;
  /** Set by the editor when YouTube reports that the video cannot be embedded. */
  notEmbeddable?: boolean;
}

export interface MusicCue {
  blockId: string;
  rep: number;
  track: TrackRef;
} // rep >= 1

/** A song slot: a contiguous run of TOP-LEVEL blocks that one track covers. */
export interface SongSlot {
  id: string;
  firstBlockId: string;
  /** Inclusive; the slot duration is the sum of the range. */
  lastBlockId: string;
  bpm?: [number, number];
  hint?: string;
  track?: TrackRef;
}

/** Hints for scaleWorkout: which blocks stretch and which repeat absorbs extra reps. */
export interface WorkoutScaling {
  warmupBlockId: string;
  cooldownBlockId: string;
  flexRepeatId?: string;
  minTimes?: number;
  maxTimes?: number;
}

export interface Workout {
  id: string;
  name: string;
  description: string;
  /** Built-in content carries pl/en text; name/description hold the en default. */
  localized?: Partial<Record<Lang, Localized>>;
  category: 'progres' | 'freestyle';
  tags: string[];
  source: { kind: 'builtin' | 'user' | 'import'; file?: string };
  blocks: Block[];
  musicCues: MusicCue[];
  fallbackPlaylist: TrackRef[];
  musicHints?: Record<string, string>; // blockId -> "what song to look for"
  /** Class format: absent = classic. Slots are only meaningful when format === 'songs'. */
  format?: 'classic' | 'songs';
  songs?: SongSlot[];
  scaling?: WorkoutScaling;
  schemaVersion: 1;
  updatedAt: string;
}

const intensitySchema = z
  .object({
    effort: effortLevelSchema.optional(),
    ftpPct: z.number().min(20).max(200).optional(),
  })
  .refine((i) => i.effort !== undefined || i.ftpPct !== undefined, {
    message: 'intensity needs effort or ftpPct',
  });

const durationSchema = z.number().int().min(1).max(14400);
const positionSchema = z.enum(['seated', 'standing']);

const blockCommon = {
  id: z.string().min(1),
  durationSec: durationSchema,
  rpm: z.number().min(30).max(150).optional(),
  position: positionSchema.optional(),
  cue: z.string().optional(),
  label: z.string().optional(),
};

const steadySchema = z.object({
  kind: z.literal('steady'),
  ...blockCommon,
  intensity: intensitySchema,
});

const rampSchema = z.object({
  kind: z.literal('ramp'),
  ...blockCommon,
  from: intensitySchema,
  to: intensitySchema,
  steps: z.number().int().min(0).max(8).optional(),
});

const repeatSchema = z.object({
  kind: z.literal('repeat'),
  id: z.string().min(1),
  times: z.number().int().min(2).max(50),
  blocks: z.array(z.discriminatedUnion('kind', [steadySchema, rampSchema])).min(1),
});

const blockSchema = z.discriminatedUnion('kind', [steadySchema, rampSchema, repeatSchema]);

const trackRefSchema = z.object({
  provider: z.enum(['spotify', 'youtube']),
  id: z.string().min(1),
  title: z.string(),
  artist: z.string().optional(),
  durationSec: z.number().min(0).optional(),
  startAtSec: z.number().min(0),
  bpm: z.number().min(BPM_MIN).max(BPM_MAX).optional(),
  notEmbeddable: z.boolean().optional(),
});

const musicCueSchema = z.object({
  blockId: z.string().min(1),
  rep: z.number().int().min(1),
  track: trackRefSchema,
});

const songSlotSchema = z.object({
  id: z.string().min(1),
  firstBlockId: z.string().min(1),
  lastBlockId: z.string().min(1),
  bpm: z
    .tuple([z.number().int().min(BPM_MIN).max(BPM_MAX), z.number().int().min(BPM_MIN).max(BPM_MAX)])
    .optional(),
  hint: z.string().max(200).optional(),
  track: trackRefSchema.optional(),
});

const localizedSchema = z.object({
  name: z.string(),
  description: z.string(),
  songHints: z.record(z.string(), z.string()).optional(),
});

export const workoutSchema: z.ZodType<Workout> = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    description: z.string(),
    localized: z
      .object({ pl: localizedSchema.optional(), en: localizedSchema.optional() })
      .optional(),
    category: z.enum(['progres', 'freestyle']),
    tags: z.array(z.string()),
    source: z.object({
      kind: z.enum(['builtin', 'user', 'import']),
      file: z.string().optional(),
    }),
    blocks: z.array(blockSchema),
    musicCues: z.array(musicCueSchema),
    fallbackPlaylist: z.array(trackRefSchema),
    musicHints: z.record(z.string(), z.string()).optional(),
    format: z.enum(['classic', 'songs']).optional(),
    songs: z.array(songSlotSchema).optional(),
    scaling: z
      .object({
        warmupBlockId: z.string().min(1),
        cooldownBlockId: z.string().min(1),
        flexRepeatId: z.string().min(1).optional(),
        minTimes: z.number().int().min(2).max(50).optional(),
        maxTimes: z.number().int().min(2).max(50).optional(),
      })
      .optional(),
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((w, ctx) => {
    // Block ids must be unique across the workout, repeat children included.
    const seen = new Set<string>();
    // blockId -> max allowed rep (1 outside repeats); repeat ids are not valid cue targets.
    const maxRep = new Map<string, number>();
    const register = (id: string, path: (string | number)[], rep: number | null): void => {
      if (seen.has(id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate block id ${id}`, path });
      }
      seen.add(id);
      if (rep !== null) maxRep.set(id, rep);
    };
    w.blocks.forEach((b, i) => {
      if (b.kind === 'repeat') {
        register(b.id, ['blocks', i, 'id'], null);
        b.blocks.forEach((c, j) => register(c.id, ['blocks', i, 'blocks', j, 'id'], b.times));
      } else {
        register(b.id, ['blocks', i, 'id'], 1);
      }
    });
    if (w.scaling) {
      const sc = w.scaling;
      const repeatIds = new Set(w.blocks.filter((b) => b.kind === 'repeat').map((b) => b.id));
      const topLevelIds = new Set(w.blocks.filter((b) => b.kind !== 'repeat').map((b) => b.id));
      for (const key of ['warmupBlockId', 'cooldownBlockId'] as const) {
        if (!topLevelIds.has(sc[key])) {
          ctx.addIssue({
            code: 'custom',
            message: `scaling.${key} must be a top-level steady or ramp block, got ${sc[key]}`,
            path: ['scaling', key],
          });
        }
      }
      if (sc.warmupBlockId === sc.cooldownBlockId) {
        ctx.addIssue({
          code: 'custom',
          message: 'scaling warm-up and cool-down must be different blocks',
          path: ['scaling', 'cooldownBlockId'],
        });
      }
      if (
        sc.flexRepeatId !== undefined &&
        (sc.minTimes === undefined || sc.maxTimes === undefined)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'scaling.flexRepeatId requires minTimes and maxTimes',
          path: ['scaling', 'flexRepeatId'],
        });
      }
      if (sc.flexRepeatId !== undefined && !repeatIds.has(sc.flexRepeatId)) {
        ctx.addIssue({
          code: 'custom',
          message: `scaling.flexRepeatId must be a repeat block, got ${sc.flexRepeatId}`,
          path: ['scaling', 'flexRepeatId'],
        });
      }
      if (sc.minTimes !== undefined && sc.maxTimes !== undefined && sc.minTimes > sc.maxTimes) {
        ctx.addIssue({
          code: 'custom',
          message: 'scaling.minTimes must not exceed maxTimes',
          path: ['scaling', 'minTimes'],
        });
      }
    }
    if (w.songs) {
      const index = new Map(w.blocks.map((b, i) => [b.id, i]));
      const slotIds = new Set<string>();
      let prevLast = -1;
      w.songs.forEach((song, i) => {
        if (slotIds.has(song.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `duplicate song id ${song.id}`,
            path: ['songs', i, 'id'],
          });
        }
        slotIds.add(song.id);
        const first = index.get(song.firstBlockId);
        const last = index.get(song.lastBlockId);
        if (first === undefined || last === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: 'song slot must reference top-level blocks',
            path: ['songs', i],
          });
          return;
        }
        if (first > last || first <= prevLast) {
          ctx.addIssue({
            code: 'custom',
            message: 'song slots must be ordered, non-empty and non-overlapping',
            path: ['songs', i],
          });
        }
        prevLast = Math.max(prevLast, last);
        if (song.bpm && song.bpm[0] > song.bpm[1]) {
          ctx.addIssue({
            code: 'custom',
            message: 'song bpm range is reversed',
            path: ['songs', i, 'bpm'],
          });
        }
      });
    }
    w.musicCues.forEach((cue, i) => {
      const max = maxRep.get(cue.blockId);
      if (max === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `music cue must target an existing steady or ramp block, got ${cue.blockId}`,
          path: ['musicCues', i, 'blockId'],
        });
      } else if (cue.rep > max) {
        ctx.addIssue({
          code: 'custom',
          message: `music cue rep ${cue.rep} exceeds ${max}`,
          path: ['musicCues', i, 'rep'],
        });
      }
    });
  }) as unknown as z.ZodType<Workout>; // zod infers `| undefined` on optionals; the declared interface is authoritative

export function totalDurationSec(w: Workout): number {
  let total = 0;
  for (const b of w.blocks) {
    if (b.kind === 'repeat') {
      total += b.times * b.blocks.reduce((s, c) => s + c.durationSec, 0);
    } else {
      total += b.durationSec;
    }
  }
  return total;
}

const MAX_NAME = 80;

function withSuffix(name: string, suffix: string): string {
  return name.slice(0, Math.max(0, MAX_NAME - suffix.length)) + suffix.slice(0, MAX_NAME);
}

export function duplicateWorkout(w: Workout, nameSuffix: string): Workout {
  const copy = structuredClone(w);
  const idMap = new Map<string, string>();
  const remap = (b: Block | SteadyBlock | RampBlock): void => {
    const fresh = newId();
    idMap.set(b.id, fresh);
    b.id = fresh;
  };
  for (const b of copy.blocks) {
    remap(b);
    if (b.kind === 'repeat') b.blocks.forEach(remap);
  }
  copy.id = newId();
  copy.name = withSuffix(w.name, nameSuffix);
  if (copy.localized) {
    for (const lang of LANGS) {
      const loc = copy.localized[lang];
      if (loc) loc.name = withSuffix(loc.name, nameSuffix);
    }
  }
  copy.source = { kind: 'user' };
  copy.updatedAt = new Date().toISOString();
  for (const c of copy.musicCues) c.blockId = idMap.get(c.blockId) ?? c.blockId;
  if (copy.scaling) {
    const sc = copy.scaling;
    sc.warmupBlockId = idMap.get(sc.warmupBlockId) ?? sc.warmupBlockId;
    sc.cooldownBlockId = idMap.get(sc.cooldownBlockId) ?? sc.cooldownBlockId;
    if (sc.flexRepeatId !== undefined)
      sc.flexRepeatId = idMap.get(sc.flexRepeatId) ?? sc.flexRepeatId;
  }
  if (copy.songs) {
    for (const song of copy.songs) {
      song.id = newId();
      song.firstBlockId = idMap.get(song.firstBlockId) ?? song.firstBlockId;
      song.lastBlockId = idMap.get(song.lastBlockId) ?? song.lastBlockId;
    }
  }
  if (copy.musicHints) {
    copy.musicHints = Object.fromEntries(
      Object.entries(copy.musicHints).map(([k, v]) => [idMap.get(k) ?? k, v]),
    );
  }
  return copy;
}

/**
 * Keeps song slots valid after blocks were removed, moved or inserted. `oldOrder` is the top-level
 * block order before the edit. A slot shrinks to its surviving blocks (in the old order) and is
 * dropped when nothing survives or it would overlap or invert after a move.
 */
export function repairSongs(w: Workout, oldOrder: readonly string[]): void {
  if (!w.songs) return;
  const newIndex = new Map(w.blocks.map((b, i) => [b.id, i]));
  const oldIndex = new Map(oldOrder.map((id, i) => [id, i]));
  const kept: SongSlot[] = [];
  let prevLast = -1;
  for (const song of w.songs) {
    const a = oldIndex.get(song.firstBlockId);
    const b = oldIndex.get(song.lastBlockId);
    if (a === undefined || b === undefined) continue;
    const survivors = oldOrder.slice(a, b + 1).filter((id) => newIndex.has(id));
    const firstId = survivors[0];
    const lastId = survivors[survivors.length - 1];
    if (firstId === undefined || lastId === undefined) continue;
    let first = newIndex.get(firstId) as number;
    const last = newIndex.get(lastId) as number;
    let startId = firstId;
    if (first <= prevLast) {
      // An earlier slot grew over our first block: give up the overlapped blocks, keep the rest.
      first = prevLast + 1;
      startId = w.blocks[first]?.id ?? '';
    }
    if (first > last || startId === '') continue;
    prevLast = last;
    kept.push({ ...song, firstBlockId: startId, lastBlockId: lastId });
  }
  if (kept.length > 0) w.songs = kept;
  else {
    delete w.songs;
    if (w.format === 'songs') delete w.format;
  }
}

/** Music cues for pinned slot tracks: the track starts at the first block (first child of a repeat). */
export function compileSongCues(w: Workout): MusicCue[] {
  const cues: MusicCue[] = [];
  for (const song of w.songs ?? []) {
    if (!song.track) continue;
    const block = w.blocks.find((b) => b.id === song.firstBlockId);
    if (!block) continue;
    const target = block.kind === 'repeat' ? block.blocks[0] : block;
    if (target) cues.push({ blockId: target.id, rep: 1, track: song.track });
  }
  return cues;
}

/** Duration of one song slot in seconds (repeats expanded). */
export function songDurationSec(w: Workout, song: SongSlot): number {
  const a = w.blocks.findIndex((b) => b.id === song.firstBlockId);
  const z = w.blocks.findIndex((b) => b.id === song.lastBlockId);
  if (a < 0 || z < a) return 0;
  return totalDurationSec({ ...w, blocks: w.blocks.slice(a, z + 1) });
}
