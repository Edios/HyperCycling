import type { CSSProperties } from 'react';
import type { CoachCue } from '../../../domain/coach';
import type { KnobHint } from '../../../domain/bike';
import { useKnobHint } from '../../bike/useKnobHint';
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

function resistanceText(
  cue: ResistanceCue,
  t: ReturnType<typeof useT>,
  hint: KnobHint | undefined,
): string {
  const base = t(cue.kind === 'addResistance' ? 'coach.addResistance' : 'coach.reduceResistance', {
    s: cue.inSec,
    effort: cue.effort,
  });
  const withKnob = hint
    ? `${base} (${t('coach.knobAt', { step: hint.step, pos: hint.position })})`
    : base;
  return cue.rpm === undefined ? withKnob : `${withKnob}, ${cue.rpm} ${t('training.rpm')}`;
}

const PRE_KEYS: Record<Extract<CoachCue, { kind: 'pre' }>['change'], MessageKey> = {
  attack: 'coach.preAttack',
  standUp: 'coach.preStandUp',
  sitDown: 'coach.preSitDown',
  cadenceUp: 'coach.preCadenceUp',
  cadenceDown: 'coach.preCadenceDown',
};

function cueText(
  cue: CoachCue,
  t: ReturnType<typeof useT>,
  knob: (effort: number) => KnobHint | undefined,
): string {
  switch (cue.kind) {
    case 'custom':
      return translateContentText(cue.text, 'cue');
    case 'cadence':
      return t('training.cadenceCue', { rpm: cue.rpm });
    case 'addResistance':
    case 'reduceResistance':
      return resistanceText(cue, t, knob(cue.effort));
    case 'pre':
      return t(PRE_KEYS[cue.change], { s: cue.inSec });
    case 'preCadence':
      return t('coach.preCadence', { s: cue.inSec, rpm: cue.rpm });
    case 'closing':
      return t(cue.after === 'position' ? 'coach.closingPosition' : 'coach.closingEffort');
    case 'silenceAhead':
      return t('coach.silenceAhead', { s: cue.inSec, q: cue.quietSec });
    default:
      return t(SIMPLE_KEYS[cue.kind]);
  }
}

export function CoachOverlay({ cue, cueKey, color, reducedMotion = false }: CoachOverlayProps) {
  const t = useT();
  const knob = useKnobHint();
  const text = cue ? cueText(cue, t, knob) : '';
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
