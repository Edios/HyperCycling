import type { CSSProperties, ReactNode } from 'react';
import type { HrZone } from '../../../domain/hr-zones';
import { useT } from '../../i18n';
import { Icon } from '../../ui/Icon';
import type { LiveMeasures } from '../live-measures';
import { fitStyle } from './fit';
import { RangeBar } from './RangeBar';
import hud from './hud.module.css';
import hrStyles from './HrTarget.module.css';
import styles from './MeasuresGroup.module.css';

export interface MeasuresGroupProps {
  /** The block's target cadence from the plan. */
  rpm?: number;
  /** True when the bike does not measure cadence: the number is the plan's target. */
  isTarget: boolean;
  /** Draw the cadence row (false when the rider hid the rpm tile). */
  cadence?: boolean;
  /** Values from connected sensors; undefined keeps the plain cadence group. */
  live?: LiveMeasures;
  /** Fit the value to the width of a Classic tile. */
  fit?: boolean;
  /** A section of a column instead of a panel of its own. */
  section?: boolean;
  /** One row per line with the label on the left (column section) instead of label over value. */
  line?: boolean;
  /** Hide the small description under the value (Minimal strip, phone). */
  bare?: boolean;
  className?: string;
}

/** Whether the group has anything to draw (a layout leaves it out otherwise). */
export function hasMeasures(
  rpm: number | undefined,
  cadence: boolean,
  live: LiveMeasures | undefined,
): boolean {
  if (!live) return cadence && rpm !== undefined;
  return (
    (cadence && (rpm !== undefined || live.cadence !== undefined)) || !!live.power || !!live.hr
  );
}

const dash = '—';

/**
 * Group M: power, cadence and heart rate, in that order. Without sensors it is the cadence target
 * of the block, as before. With sensors each row shows the live value (power as a 3 s average) and
 * the block's target under it; a missing value is "—" and dimmed, never 0. A line at the bottom
 * says when a sensor is silent or reconnecting.
 */
export function MeasuresGroup({
  rpm,
  isTarget,
  cadence = true,
  live,
  fit = false,
  section = false,
  line = false,
  bare = false,
  className,
}: MeasuresGroupProps) {
  const t = useT();
  const rows: ReactNode[] = [];

  if (live?.power) {
    const { watts, target } = live.power;
    rows.push(
      <Row
        key="power"
        testId="live-power"
        label={t('training.live.power')}
        value={watts === null ? dash : String(watts)}
        unit={t('training.watts')}
        note={
          !bare && target !== null
            ? t('training.live.target', { value: `${target} ${t('training.watts')}` })
            : undefined
        }
        short={target !== null ? String(target) : undefined}
        fit={fit}
      />,
    );
  }

  if (cadence && live?.cadence) {
    const { rpm: actual, target, judgement, band: cadenceBand } = live.cadence;
    const hint =
      judgement === 'low'
        ? t('training.live.faster')
        : judgement === 'high'
          ? t('training.live.slower')
          : null;
    rows.push(
      <Row
        key="cadence"
        testId="rpm-value-number"
        label={t('training.cadence')}
        value={actual === null ? dash : String(actual)}
        unit={t('training.rpm')}
        note={
          bare
            ? undefined
            : [target !== null ? t('training.live.target', { value: target }) : null, hint]
                .filter(Boolean)
                .join(' · ') || undefined
        }
        icon={judgement === 'low' ? 'up' : judgement === 'high' ? 'down' : undefined}
        short={target !== null ? String(target) : undefined}
        band={cadenceBand}
        bandValue={actual}
        bandTestId="cadence-bar"
        fit={fit}
      />,
    );
  } else if (cadence) {
    rows.push(
      <Row
        key="cadence"
        testId="rpm-value-number"
        label={t('training.cadence')}
        value={rpm === undefined ? dash : String(Math.round(rpm))}
        unit={t('training.rpm')}
        note={!bare && isTarget && rpm !== undefined ? t('training.targetFromPlan') : undefined}
        fit={fit}
      />,
    );
  }

  if (live?.hr) {
    const { bpm, zone, noContact, band: hrBand } = live.hr;
    rows.push(
      <Row
        key="hr"
        testId="live-hr"
        label={t('training.live.heartRate')}
        value={bpm === null ? dash : String(bpm)}
        unit={t('training.live.bpm')}
        note={!bare && noContact ? t('training.live.noContact') : undefined}
        zone={zone}
        band={hrBand}
        bandValue={bpm}
        bandTestId="hr-bar"
        fit={fit}
      />,
    );
  }

  const classes = [
    section ? hud.sec : hud.panel,
    styles.measures,
    fit ? styles.fit : '',
    line ? styles.line : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      data-g="M"
      data-testid="rpm-value"
      data-rows={rows.length}
      {...(live ? { 'data-signal': live.signal } : {})}
    >
      {rows}
      {live && live.signal !== 'live' && (
        <div className={`${hud.cap} ${styles.signal}`} data-testid="live-signal" role="status">
          <Icon name="bluetooth" size="1.1em" />
          <span>{t(`training.live.${live.signal}`)}</span>
        </div>
      )}
    </div>
  );
}

function Row({
  testId,
  label,
  value,
  unit,
  note,
  icon,
  zone,
  short,
  band,
  bandValue = null,
  bandTestId,
  fit,
}: {
  testId: string;
  label: string;
  value: string;
  unit: string;
  note?: string;
  icon?: 'up' | 'down';
  zone?: HrZone | null;
  /** Compact target ("/138") shown beside the number where the note line does not fit. */
  short?: string;
  /** Target range bar under the row (D22). */
  band?: { low: number; high: number };
  bandValue?: number | null;
  bandTestId?: string;
  fit: boolean;
}) {
  const t = useT();
  const zoneLabel = zone != null ? t('training.live.zone', { zone }) : '';
  const valueStyle: CSSProperties | undefined = fit ? fitStyle(value.length) : undefined;
  const missing = value === dash;
  return (
    <div className={`${styles.row} ${missing ? styles.missing : ''}`}>
      <div className={styles.head}>
        <div className={hud.lbl}>
          {label}
          {zone != null && (
            <span
              className={`${styles.zone} ${hrStyles[`z${zone}` as `z${HrZone}`]}`}
              data-testid="live-hr-zone"
              data-zone={zone}
            >
              {zoneLabel}
            </span>
          )}
        </div>
        {note && (
          <div className={`${hud.cap} ${styles.note}`}>
            {icon && <Icon name={icon} size="1em" />} {note}
          </div>
        )}
      </div>
      <div className={styles.vv}>
        <span data-testid={testId} className={`${hud.big} ${styles.value}`} style={valueStyle}>
          {value}
        </span>
        <span className={hud.unit}>{unit}</span>
        {(short || icon) && (
          <span className={`${hud.cap} ${styles.short}`} aria-hidden="true">
            {short && `/${short}`}
            {icon && <Icon name={icon} size="1em" />}
          </span>
        )}
      </div>
      {band && <RangeBar value={bandValue} low={band.low} high={band.high} testId={bandTestId} />}
    </div>
  );
}
