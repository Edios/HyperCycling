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

const byId = new Map(builtinWorkouts.map((w) => [w.id, w]));

/** Built-in workouts only; user workouts live in the repositories. */
export function getWorkout(id: string): Workout | undefined {
  return byId.get(id);
}
