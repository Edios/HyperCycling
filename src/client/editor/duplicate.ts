import type { Lang } from '../../domain/lang';
import { duplicateWorkout, type Workout } from '../../domain/workout';
import { localizedText } from '../data/localized';
import { getRepositories } from '../data/repositories';

/**
 * A user-owned copy of `w` named in the current language (built-in text is flattened into
 * name/description so the editable fields are the ones shown), saved to the repositories.
 */
export async function duplicateAndSave(w: Workout, lang: Lang, suffix: string): Promise<Workout> {
  const text = localizedText(w, lang);
  const { localized: _drop, ...rest } = w;
  void _drop;
  const copy = duplicateWorkout(
    { ...rest, name: text.name, description: text.description },
    suffix,
  );
  const repos = await getRepositories();
  await repos.workouts.put(copy);
  return copy;
}
