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

type ResistanceCue = Extract<CoachCue, { kind: 'addResistance' | 'reduceResistance' }>;

function resistanceText(cue: ResistanceCue, t: ReturnType<typeof useT>): string {
  const base = t(cue.kind === 'addResistance' ? 'coach.addResistance' : 'coach.reduceResistance', {
    s: cue.inSec,
    effort: cue.effort,
  });
  return cue.rpm === undefined ? base : `${base}, ${cue.rpm} ${t('training.rpm')}`;
}

export function CoachOverlay({ cue, cueKey, color, reducedMotion = false }: CoachOverlayProps) {
  const t = useT();
  const text = !cue
    ? ''
    : cue.kind === 'custom'
      ? translateContentText(cue.text, 'cue')
      : cue.kind === 'cadence'
        ? t('training.cadenceCue', { rpm: cue.rpm })
        : cue.kind === 'addResistance' || cue.kind === 'reduceResistance'
          ? resistanceText(cue, t)
          : t(SIMPLE_KEYS[cue.kind]);
  const style: CSSProperties & Record<'--c', string> = { '--c': color };
  return (
    <>
      {/* What a screen reader announces; the oversized visual below is decoration for it. */}
      <div data-testid="coach-live" aria-live="polite" aria-atomic="true" className="sr-only">
        {cue && <span key={cueKey}>{text}</span>}
      </div>
      {cue && (
        <div
          key={cueKey}
          data-testid="coach-overlay"
          data-animated={!reducedMotion}
          aria-hidden="true"
          className={`${styles.root} ${reducedMotion ? '' : styles.animated}`}
          style={style}
        >
          {text}
        </div>
      )}
    </>
  );
}
