import type { CSSProperties } from 'react';
import type { CoachCue } from '../../../domain/coach';
import { useT, type MessageKey } from '../../i18n';
import { translateContentText } from '../content-text';
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
  const text = !cue
    ? ''
    : cue.kind === 'custom'
      ? translateContentText(cue.text, 'cue')
      : cue.kind === 'cadence'
        ? t('training.cadenceCue', { rpm: cue.rpm })
        : t(SIMPLE_KEYS[cue.kind]);
  const style: CSSProperties & Record<'--c', string> = { '--c': color };
  return (
    <div data-testid="coach-live" aria-live="polite" className={styles.live}>
      {cue && (
        <div
          key={cueKey}
          data-testid="coach-overlay"
          data-animated={!reducedMotion}
          className={`${styles.root} ${reducedMotion ? '' : styles.animated}`}
          style={style}
        >
          {text}
        </div>
      )}
    </div>
  );
}
