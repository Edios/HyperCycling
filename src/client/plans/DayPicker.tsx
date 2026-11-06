import { useMemo } from 'react';
import { useLang, useT } from '../i18n';
import styles from './DayPicker.module.css';

/** 2024-01-01 is a Monday; weekday names come from Intl so they follow the UI language. */
const MONDAY = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

export function weekdayNames(lang: string, weekday: 'short' | 'long'): string[] {
  const fmt = new Intl.DateTimeFormat(lang, { weekday, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(MONDAY + i * DAY_MS));
}

export interface DayPickerProps {
  /** Chosen weekdays, 0 = Monday. Empty = no fixed days. */
  value: readonly number[];
  onChange: (days: number[]) => void;
  /** Sessions per week, shown in the hint. */
  sessions: number;
}

/** Optional weekday toggles: pick the days you want to ride, or none for the default spread. */
export function DayPicker({ value, onChange, sessions }: DayPickerProps) {
  const t = useT();
  const [lang] = useLang();
  const shortDays = useMemo(() => weekdayNames(lang, 'short'), [lang]);
  const longDays = useMemo(() => weekdayNames(lang, 'long'), [lang]);

  function toggle(d: number): void {
    onChange(
      value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b),
    );
  }

  return (
    <div className={styles.picker} data-testid="day-picker">
      <div role="group" aria-label={t('plans.trainingDays')} className={styles.days}>
        {shortDays.map((label, d) => (
          <button
            key={d}
            type="button"
            aria-pressed={value.includes(d)}
            aria-label={longDays[d]}
            className={styles.day}
            onClick={() => toggle(d)}
          >
            {label}
          </button>
        ))}
      </div>
      <small className={styles.hint}>
        {value.length === 0
          ? t('plans.trainingDaysNone', { n: sessions })
          : value.length === sessions
            ? t('plans.trainingDaysSet')
            : t('plans.trainingDaysMismatch', { n: sessions })}
      </small>
    </div>
  );
}
