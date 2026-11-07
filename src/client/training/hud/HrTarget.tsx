import { HR_ZONES, hrTargetFor, type HrZone } from '../../../domain/hr-zones';
import type { Segment } from '../../../domain/segments';
import { useT } from '../../i18n';
import { useMePlayer } from '../../settings/useMePlayer';
import { useShowHrZones } from '../../settings/useShowHrZones';
import hud from './hud.module.css';
import styles from './HrTarget.module.css';

export interface HrTargetProps {
  segment: Segment;
  /** Seconds elapsed inside the current block. */
  elapsedInSegSec: number;
  className?: string;
}

/** Heart-rate zone chip for the current block: "Z3 · 128–146 bpm", or "Z3 · 70–80 % HRmax". */
export function HrTarget({ segment, elapsedInSegSec, className }: HrTargetProps) {
  const t = useT();
  const show = useShowHrZones();
  const { me } = useMePlayer();
  if (!show) return null;
  const target = hrTargetFor(segment, elapsedInSegSec, me?.hrMax);
  if (!target) return null;
  const { zone, bpm } = target;
  return (
    <div
      className={`${hud.lbl} ${styles.chip} ${styles[`z${zone}` as `z${HrZone}`]}${className ? ` ${className}` : ''}`}
      data-testid="hr-target"
      data-zone={zone}
      title={t(`hr.zone${zone}`)}
    >
      {bpm
        ? t('hr.withBpm', { zone, min: bpm.min, max: bpm.max })
        : t('hr.withPct', { zone, min: pct(zone).min, max: pct(zone).max })}
    </div>
  );
}

function pct(zone: HrZone): { min: number; max: number } {
  const d = HR_ZONES[zone - 1];
  return { min: d?.minPct ?? 0, max: d?.maxPct ?? 0 };
}
