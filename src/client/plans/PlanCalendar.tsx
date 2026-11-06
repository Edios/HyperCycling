import { useMemo, type CSSProperties } from 'react';
import type { Plan, PlanSettings, PlanSlot } from '../../domain/plan';
import { ftpTestKindOf } from '../../domain/ftp-test';
import type { Equipment } from '../../domain/settings';
import { scaleForPlan } from '../../domain/scale';
import { getWorkout } from '../data/builtin';
import { localizedText } from '../data/localized';
import { useLang, useT } from '../i18n';
import { weekdayNames } from './DayPicker';
import { effectiveSession } from './effective-session';
import { rideDays, workoutPeakLevel } from './model';
import styles from './PlanCalendar.module.css';

export interface PlanCalendarProps {
  plan: Plan;
  settings: PlanSettings;
  equipment: Equipment;
}

const SLOTS: readonly PlanSlot[] = ['progres', 'freestyle'];
interface Cell {
  kind: 'rest' | 'session' | 'test' | 'free';
  level?: number;
  name?: string;
}

const LEGEND = [
  { color: 'var(--z1)', key: 'plans.calendar.legendLight' },
  { color: 'var(--z3)', key: 'plans.calendar.legendSteady' },
  { color: 'var(--z5)', key: 'plans.calendar.legendTempo' },
  { color: 'var(--z7)', key: 'plans.calendar.legendHard' },
  { color: 'var(--z9)', key: 'plans.calendar.legendMax' },
] as const;

/** Weeks x weekdays grid; each ride is coloured by the intensity of the workout actually served. */
export function PlanCalendar({ plan, settings, equipment }: PlanCalendarProps) {
  const t = useT();
  const [lang] = useLang();
  const { layout, skipFirstTest, trainingDays } = settings;

  const shortDays = useMemo(() => weekdayNames(lang, 'short'), [lang]);
  const longDays = useMemo(() => weekdayNames(lang, 'long'), [lang]);

  const rows = useMemo<Cell[][]>(() => {
    const days = rideDays(layout, trainingDays);
    return plan.weeks.map((_, w) => {
      const cells: Cell[] = Array.from({ length: 7 }, () => ({ kind: 'rest' }));
      days.forEach((day, i) => {
        const slot = SLOTS[i];
        if (slot === undefined) {
          // Third ride of plusFreestyle: never blocking, no fixed workout.
          cells[day] = { kind: 'free' };
          return;
        }
        const id = effectiveSession(plan, w + 1, slot, equipment, layout, skipFirstTest);
        if (id === undefined) return;
        const workout = getWorkout(id);
        if (!workout) return;
        const name = localizedText(workout, lang).name;
        if (ftpTestKindOf(id) !== undefined) {
          cells[day] = { kind: 'test', name };
          return;
        }
        let shown = workout;
        try {
          shown = scaleForPlan(workout, settings);
        } catch (err) {
          console.warn('Scaling the calendar workout failed, using it unscaled', err);
        }
        cells[day] = { kind: 'session', level: workoutPeakLevel(shown), name };
      });
      return cells;
    });
  }, [plan, settings, equipment, layout, skipFirstTest, trainingDays, lang]);

  return (
    <div className={styles.cal} data-testid="plan-calendar">
      <div className={styles.head}>
        <b>{t('plans.calendar.title')}</b>
        <span>{t('plans.calendar.hint')}</span>
      </div>
      <div className={styles.grid} role="table" aria-label={t('plans.calendar.title')}>
        <div role="row" className={styles.row}>
          <span role="columnheader" />
          {shortDays.map((d, i) => (
            <span key={i} role="columnheader" className={styles.day}>
              {d}
            </span>
          ))}
        </div>
        {rows.map((cells, w) => (
          <div key={w} role="row" className={styles.row} data-testid="calendar-week">
            <span role="rowheader" className={styles.week}>
              {t('plan.weekShort', { n: w + 1 })}
            </span>
            {cells.map((c, d) => {
              if (c.kind === 'rest') {
                return <span key={d} role="cell" className={styles.rest} />;
              }
              const label = t('plans.calendar.cell', {
                week: t('plan.weekShort', { n: w + 1 }),
                day: longDays[d] ?? '',
                name: c.kind === 'free' ? t('plans.calendar.freeRide') : (c.name ?? ''),
              });
              if (c.kind === 'test') {
                return (
                  <span
                    key={d}
                    role="cell"
                    data-testid="calendar-test"
                    aria-label={label}
                    title={c.name}
                    className={`${styles.cell} ${styles.test}`}
                  >
                    {t('plans.calendar.test')}
                  </span>
                );
              }
              return (
                <span
                  key={d}
                  role="cell"
                  data-testid="calendar-session"
                  data-level={c.level}
                  aria-label={label}
                  title={c.kind === 'free' ? t('plans.calendar.freeRide') : c.name}
                  className={`${styles.cell} ${c.kind === 'free' ? styles.free : ''}`}
                  style={
                    c.kind === 'free'
                      ? undefined
                      : ({ '--c': `var(--z${c.level ?? 4})` } as CSSProperties)
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
      <ul className={styles.legend}>
        <li>
          <i className={styles.swatchTest} aria-hidden="true" />
          {t('plans.calendar.legendTest')}
        </li>
        {LEGEND.map(({ color, key }) => (
          <li key={key}>
            <i
              className={styles.swatch}
              style={{ '--c': color } as CSSProperties}
              aria-hidden="true"
            />
            {t(key)}
          </li>
        ))}
      </ul>
    </div>
  );
}
