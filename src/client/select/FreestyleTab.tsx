import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Workout } from '../../domain/workout';
import { ImportModal } from '../editor/ImportModal';
import { useLibrary } from '../data/useLibrary';
import { useLang, useT } from '../i18n';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { filterLibrary, FILTER_IDS, type FilterId } from './model';
import { WorkoutList } from './WorkoutList';
import { WorkoutPreview } from './WorkoutPreview';
import styles from './FreestyleTab.module.css';

const NARROW_QUERY = '(max-width: 759.98px)';

/** True below the 760px breakpoint, where the preview becomes a bottom sheet. */
function useNarrow(): boolean {
  const get = (): boolean =>
    typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const on = (): void => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** Freestyle tab: search, one scrollable chip row, a light workout list and a preview pane/sheet. */
export function FreestyleTab() {
  const t = useT();
  const [lang] = useLang();
  const { workouts, loaded } = useLibrary();
  const navigate = useNavigate();
  const narrow = useNarrow();
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const shown = useMemo(
    () => filterLibrary(workouts, filter, query, lang),
    [workouts, filter, query, lang],
  );
  // The pane always shows something on wide screens; on phones only a tapped row is selected.
  const activeId =
    selectedId !== null && shown.some((w) => w.id === selectedId)
      ? selectedId
      : narrow
        ? null
        : (shown[0]?.id ?? null);
  const active = shown.find((w) => w.id === activeId);
  const sheetShown = narrow && sheetOpen && active !== undefined;

  useEffect(() => {
    if (!sheetShown) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetShown]);

  const select = (id: string): void => {
    setSelectedId(id);
    setSheetOpen(true);
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (shown.length === 0) return;
    const idx = shown.findIndex((w) => w.id === activeId);
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(shown.length - 1, idx + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, idx < 0 ? 0 : idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = shown.length - 1;
    else if (e.key === 'Enter' && active) {
      e.preventDefault();
      void navigate(`/setup/${encodeURIComponent(active.id)}`);
      return;
    } else return;
    e.preventDefault();
    const w = shown[next] as Workout;
    setSelectedId(w.id);
    document.getElementById(`wk-${w.id}`)?.scrollIntoView?.({ block: 'nearest' });
  };

  return (
    <div className={styles.page}>
      <h1 className="sr-only">{t('free.heading')}</h1>
      <div className={styles.header}>
        <div className={styles.searchWrap}>
          <svg
            className={styles.searchIcon}
            viewBox="0 0 20 20"
            width="18"
            height="18"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M13 13l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            className={styles.search}
            aria-label={t('free.searchLabel')}
            placeholder={t('free.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className={styles.count} aria-live="polite">
          {loaded ? t('free.count', { n: shown.length }) : ''}
        </span>
        <div className={styles.actions}>
          <Button className={styles.link} onClick={() => setImporting(true)}>
            {t('free.importFile')}
          </Button>
          <Button variant="primary" onClick={() => void navigate('/editor/new')}>
            {t('free.newWorkout')}
          </Button>
        </div>
      </div>
      <div className={styles.chips} role="group" aria-label={t('free.filterLabel')}>
        {FILTER_IDS.map((id) => (
          <Chip key={id} on={filter === id} onClick={() => setFilter(id)}>
            {t(`free.filters.${id}`)}
          </Chip>
        ))}
      </div>
      {!loaded ? (
        <div className={styles.ghosts} aria-busy="true" data-testid="freestyle-loading">
          <p className={styles.loading} role="status">
            {t('free.loading')}
          </p>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={styles.ghost} aria-hidden="true">
              <i />
              <i />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className={styles.empty} data-testid="freestyle-empty">
          <div className={styles.zones} aria-hidden="true" />
          <h2 className={styles.emptyTitle}>
            {query.trim() !== '' ? t('free.emptyFor', { q: query.trim() }) : t('free.empty')}
          </h2>
          {query.trim() !== '' && <p>{t('free.emptyHint')}</p>}
          {query.trim() !== '' && (
            <Button onClick={() => setQuery('')}>{t('free.clearSearch')}</Button>
          )}
        </div>
      ) : (
        <div className={styles.layout}>
          <WorkoutList
            workouts={shown}
            activeId={activeId}
            onSelect={select}
            onKeyDown={onListKey}
          />
          {active && !narrow && (
            <aside className={styles.pane} aria-label={t('free.previewLabel')}>
              <WorkoutPreview key={active.id} workout={active} />
            </aside>
          )}
        </div>
      )}
      {sheetShown && active && (
        <>
          <div
            className={styles.dim}
            data-testid="sheet-dim"
            onClick={() => setSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={t('free.previewLabel')}
            data-testid="preview-sheet"
          >
            <WorkoutPreview key={active.id} workout={active} onClose={() => setSheetOpen(false)} />
          </div>
        </>
      )}
      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onOpen={(w: Workout) => {
            setImporting(false);
            void navigate('/editor/new', { state: { imported: w } });
          }}
        />
      )}
    </div>
  );
}
