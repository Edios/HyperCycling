import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { workoutSchema, type Workout } from '../../domain/workout';
import { getWorkout } from '../data/builtin';
import { getRepositories } from '../data/repositories';
import { useT } from '../i18n';
import { Editor } from './Editor';
import { newWorkoutDraft } from './model';
import styles from './EditorScreen.module.css';

type Loaded =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; workout: Workout; readOnly: boolean; isNew: boolean };

function importedFrom(state: unknown): Workout | undefined {
  const raw = (state as { imported?: unknown } | null)?.imported;
  const parsed = workoutSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Route /editor/:workoutId; `new` starts a draft (or an imported workout passed in router state). */
export function EditorScreen() {
  const t = useT();
  const { workoutId = '' } = useParams();
  const location = useLocation();
  const [loaded, setLoaded] = useState<{ id: string; value: Loaded } | undefined>();

  const builtin = getWorkout(workoutId);

  // A fresh draft per visit to /editor/new (location.key changes on every navigation).
  const draft = useMemo<Workout | undefined>(
    () =>
      workoutId === 'new'
        ? (importedFrom(location.state) ?? newWorkoutDraft(t('editor.newName')))
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t only seeds the default name
    [workoutId, location.key],
  );

  useEffect(() => {
    if (workoutId === 'new' || builtin) return undefined;
    let live = true;
    void (async () => {
      let value: Loaded = { status: 'missing' };
      try {
        const repos = await getRepositories();
        const w = await repos.workouts.get(workoutId);
        if (w)
          value = {
            status: 'ready',
            workout: w,
            readOnly: w.source.kind === 'builtin',
            isNew: false,
          };
      } catch (err) {
        console.warn('Loading the workout failed', err);
      }
      if (live) setLoaded({ id: workoutId, value });
    })();
    return () => {
      live = false;
    };
  }, [workoutId, builtin]);

  if (draft) {
    return (
      <Editor
        key={`${location.key}:new`}
        initial={draft}
        readOnly={false}
        isNew
        startDirty={importedFrom(location.state) !== undefined}
      />
    );
  }
  const current: Loaded | undefined = builtin
    ? { status: 'ready', workout: builtin, readOnly: true, isNew: false }
    : loaded?.id === workoutId
      ? loaded.value
      : undefined;
  if (!current) return <div aria-busy="true" className={styles.blank} />;
  if (current.status !== 'ready') {
    return (
      <div className={styles.blank} data-testid="editor-missing">
        <p>{t('editor.notFound')}</p>
        <Link to="/freestyle">{t('editor.back')}</Link>
      </div>
    );
  }
  return (
    <Editor
      key={current.workout.id}
      initial={current.workout}
      readOnly={current.readOnly}
      isNew={current.isNew}
    />
  );
}
