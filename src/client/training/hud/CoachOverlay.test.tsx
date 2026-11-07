import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { CoachOverlay } from './CoachOverlay';

afterEach(() => setLang('en'));

describe('CoachOverlay resistance cues', () => {
  it('says what to do by target, with the cadence', () => {
    render(
      <CoachOverlay
        cue={{ kind: 'addResistance', effort: 6, rpm: 90, inSec: 5 }}
        cueKey={1}
        color="#fff"
      />,
    );
    expect(screen.getByTestId('coach-live')).toHaveTextContent(
      'In 5 s: add resistance → effort 6, 90 rpm',
    );
  });

  it('reduces resistance and omits the cadence when unknown', () => {
    render(
      <CoachOverlay
        cue={{ kind: 'reduceResistance', effort: 4, inSec: 5 }}
        cueKey={1}
        color="#fff"
      />,
    );
    expect(screen.getByTestId('coach-live')).toHaveTextContent(
      'In 5 s: reduce resistance → effort 4',
    );
    expect(screen.getByTestId('coach-live').textContent ?? '').not.toMatch(/rpm/);
  });

  it('speaks Polish', () => {
    setLang('pl');
    render(
      <CoachOverlay
        cue={{ kind: 'addResistance', effort: 6, rpm: 90, inSec: 5 }}
        cueKey={1}
        color="#fff"
      />,
    );
    expect(screen.getByTestId('coach-live')).toHaveTextContent(
      'Za 5 s: dodaj opór → wysiłek 6, 90 obr/min',
    );
  });
});
