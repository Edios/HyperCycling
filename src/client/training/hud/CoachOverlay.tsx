import type { CSSProperties } from 'react';
import type { CoachCue } from '../../../domain/coach';
import { useT, type MessageKey } from '../../i18n';
import styles from './CoachOverlay.module.css';

export interface CoachOverlayProps {
  cue: CoachCue | null;
  /** Changing key replays the animation, even for an identical cue. */
  cueKey: number;
  color: string;
  reducedMotion?: boolean;
}

const SIMPLE_KEYS: Record<
  'attack' | 'standUp' | 'sitDown' | 'cadenceUp' | 'cadenceDown',
  MessageKey
> = {
  attack: 'coach.attack',
  standUp: 'coach.standUp',
  sitDown: 'coach.sitDown',
  cadenceUp: 'coach.cadenceUp',
  cadenceDown: 'coach.cadenceDown',
};

export function CoachOverlay({ cue, cueKey, color, reducedMotion = false }: CoachOverlayProps) {
  const t = useT();
  if (!cue) return null;
  const text =
    cue.kind === 'custom'
      ? cue.text
      : cue.kind === 'cadence'
        ? t('training.cadenceCue', { rpm: cue.rpm })
        : t(SIMPLE_KEYS[cue.kind]);
  const style: CSSProperties & Record<'--c', string> = { '--c': color };
  return (
    <div
      key={cueKey}
      data-testid="coach-overlay"
      data-animated={!reducedMotion}
      role="status"
      className={`${styles.root} ${reducedMotion ? '' : styles.animated}`}
      style={style}
    >
      {text}
    </div>
  );
}
