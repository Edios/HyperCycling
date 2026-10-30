import { useEffect, useMemo, useState } from 'react';
import type { Workout } from '../../domain/workout';
import { builtinWorkouts } from './builtin';
import { getRepositories } from './repositories';

/** User and imported workouts get the `mine` tag so the Mine filter can find them. */
function asMine(w: Workout): Workout {
  return w.tags.includes('mine') ? w : { ...w, tags: [...w.tags, 'mine'] };
}

/** Built-in workouts plus the user's own; built-ins show immediately, user ones join once loaded. */
export function useLibrary(): { workouts: Workout[]; loaded: boolean } {
  const [mine, setMine] = useState<Workout[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const repos = await getRepositories();
        const list = await repos.workouts.list();
        if (live) setMine(list.filter((w) => w.source.kind !== 'builtin').map(asMine));
      } catch (err) {
        console.warn('Loading user workouts failed', err);
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const workouts = useMemo(() => {
    const ids = new Set(mine.map((w) => w.id));
    return [...builtinWorkouts.filter((w) => !ids.has(w.id)), ...mine];
  }, [mine]);
  return { workouts, loaded };
}
