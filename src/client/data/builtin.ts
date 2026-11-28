import { experienceSchema, type Experience } from '../../domain/experience';
import { planSchema, type Plan } from '../../domain/plan';
import { workoutSchema, type Workout } from '../../domain/workout';

const workoutFiles = import.meta.glob<unknown>('../../content/workouts/*.json', {
  eager: true,
  import: 'default',
});
const planFiles = import.meta.glob<unknown>('../../content/plans/*.json', {
  eager: true,
  import: 'default',
});

const experienceFiles = import.meta.glob<unknown>('../../content/experiences/*.json', {
  eager: true,
  import: 'default',
});

// Song suggestions per Experience in one small file the owner can edit (names and tempos, no ids).
const hintFiles = import.meta.glob<unknown>('../../content/music-hints/*.json', {
  eager: true,
  import: 'default',
});

// Beat grids and parts of songs (choreography), one file per song.
const cueSheetFiles = import.meta.glob<unknown>('../../content/cue-sheets/*.json', {
  eager: true,
  import: 'default',
});

/** experience id -> suggestions, merged from every hints file; an experience's own list wins. */
function loadHints(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [file, raw] of Object.entries(hintFiles)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`Invalid built-in music hints ${file}`);
    }
    Object.assign(out, raw);
  }
  return out;
}

const withHints = (files: Record<string, unknown>): Record<string, unknown> => {
  const hints = loadHints();
  const sheets = Object.entries(cueSheetFiles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, raw]) => raw);
  return Object.fromEntries(
    Object.entries(files).map(([file, raw]) => {
      const { choreography, ...rest } = raw as { choreography?: unknown; [key: string]: unknown };
      const id = rest.id;
      const withOwnHints =
        typeof id === 'string' && rest.musicHints === undefined && hints[id] !== undefined
          ? { ...rest, musicHints: hints[id] }
          : rest;
      // Cue sheets only for an experience that asks for them ("choreography": true): its blocks
      // are anchored to the songs' parts. Elsewhere "stand up 4..1" could land on a seated block.
      return [
        file,
        choreography === true && sheets.length > 0
          ? { ...withOwnHints, cueSheets: sheets }
          : withOwnHints,
      ];
    }),
  );
};

interface Parser<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false; error: Error };
}

function load<T>(kind: string, files: Record<string, unknown>, schema: Parser<T>): T[] {
  const out: T[] = [];
  for (const [file, raw] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const r = schema.safeParse(raw);
    // Fail loudly at module load: shipping an invalid built-in file is a programming error.
    if (!r.success) throw new Error(`Invalid built-in ${kind} ${file}: ${r.error.message}`);
    out.push(r.data);
  }
  return out;
}

export const builtinWorkouts: Workout[] = load('workout', workoutFiles, workoutSchema);
export const builtinPlans: Plan[] = load('plan', planFiles, planSchema);

export const builtinExperiences: Experience[] = load(
  'experience',
  withHints(experienceFiles),
  experienceSchema,
);

const byId = new Map(builtinWorkouts.map((w) => [w.id, w]));

/** Built-in workouts only; user workouts live in the repositories. */
export function getWorkout(id: string): Workout | undefined {
  return byId.get(id);
}

const experienceById = new Map(builtinExperiences.map((e) => [e.id, e]));

export function getExperience(id: string): Experience | undefined {
  return experienceById.get(id);
}
