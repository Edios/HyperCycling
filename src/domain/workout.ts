import { z } from 'zod';
import { effortLevelSchema, type EffortLevel } from './effort';
import { LANGS, type Lang, type Localized } from './lang';
import { newId } from './ids';

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
  /** Set by the editor when YouTube reports that the video cannot be embedded. */
  notEmbeddable?: boolean;
}

export interface MusicCue {
  blockId: string;
  rep: number;
  track: TrackRef;
} // rep >= 1

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
  notEmbeddable: z.boolean().optional(),
});

const musicCueSchema = z.object({
  blockId: z.string().min(1),
  rep: z.number().int().min(1),
  track: trackRefSchema,
});

const localizedSchema = z.object({ name: z.string(), description: z.string() });

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
  if (copy.musicHints) {
    copy.musicHints = Object.fromEntries(
      Object.entries(copy.musicHints).map(([k, v]) => [idMap.get(k) ?? k, v]),
    );
  }
  return copy;
}
