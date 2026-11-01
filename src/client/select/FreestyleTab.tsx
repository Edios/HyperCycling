import { useMemo, useState } from 'react';
import { useLibrary } from '../data/useLibrary';
import { useLang, useT } from '../i18n';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { filterLibrary, FILTER_IDS, type FilterId } from './model';
import { WorkoutCard } from './WorkoutCard';
import styles from './FreestyleTab.module.css';

/** Freestyle tab: filter chips, search, import/new stubs and the grid of workout cards. */
export function FreestyleTab() {
  const t = useT();
  const [lang] = useLang();
  const { workouts, loaded } = useLibrary();
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () => filterLibrary(workouts, filter, query, lang),
    [workouts, filter, query, lang],
  );

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.chips} role="group" aria-label={t('free.filterLabel')}>
          {FILTER_IDS.map((id) => (
            <Chip key={id} on={filter === id} onClick={() => setFilter(id)}>
              {t(`free.filters.${id}`)}
            </Chip>
          ))}
        </div>
        <div className={styles.actions}>
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
          <Button disabled title={t('common.comingSoon')}>
            {t('free.importFile')}
          </Button>
          <Button variant="primary" disabled title={t('common.comingSoon')}>
            {t('free.newWorkout')}
          </Button>
        </div>
      </div>
      {!loaded ? (
        <div aria-busy="true" />
      ) : shown.length === 0 ? (
        <p className={styles.empty}>{t('free.empty')}</p>
      ) : (
        <div className={styles.grid}>
          {shown.map((w) => (
            <WorkoutCard key={w.id} workout={w} />
          ))}
        </div>
      )}
    </div>
  );
}
