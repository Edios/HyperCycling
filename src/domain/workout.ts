import { z } from 'zod';
import { effortLevelSchema, type EffortLevel } from './effort';
import type { Lang, Localized } from './lang';
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
}

export interface MusicCue {
  blockId: string;
  rep: number;
  track: TrackRef;
} // rep >= 1

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
});

const musicCueSchema = z.object({
  blockId: z.string().min(1),
  rep: z.number().int().min(1),
  track: trackRefSchema,
});

const localizedSchema = z.object({ name: z.string(), description: z.string() });

function collectIds(blocks: Block[]): string[] {
  return blocks.flatMap((b) =>
    b.kind === 'repeat' ? [b.id, ...b.blocks.map((c) => c.id)] : [b.id],
  );
}

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
    schemaVersion: z.literal(1),
    updatedAt: z.string(),
  })
  .superRefine((w, ctx) => {
    const ids = new Set(collectIds(w.blocks));
    w.musicCues.forEach((cue, i) => {
      if (!ids.has(cue.blockId)) {
        ctx.addIssue({
          code: 'custom',
          message: `music cue references unknown block ${cue.blockId}`,
          path: ['musicCues', i, 'blockId'],
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

export function duplicateWorkout(w: Workout, nameSuffix: string): Workout {
  const idMap = new Map<string, string>();
  const remap = (oldId: string): string => {
    const fresh = newId();
    idMap.set(oldId, fresh);
    return fresh;
  };
  const blocks: Block[] = w.blocks.map((b) =>
    b.kind === 'repeat'
      ? { ...b, id: remap(b.id), blocks: b.blocks.map((c) => ({ ...c, id: remap(c.id) })) }
      : { ...b, id: remap(b.id) },
  );
  const copy: Workout = {
    ...structuredClone(w),
    id: newId(),
    name: w.name + nameSuffix,
    source: { kind: 'user' },
    blocks: structuredClone(blocks),
    musicCues: w.musicCues.map((c) => ({
      ...structuredClone(c),
      blockId: idMap.get(c.blockId) ?? c.blockId,
    })),
  };
  if (w.musicHints) {
    copy.musicHints = Object.fromEntries(
      Object.entries(w.musicHints).map(([k, v]) => [idMap.get(k) ?? k, v]),
    );
  }
  return copy;
}
