import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ settings: undefined as Settings | undefined }));

vi.mock('../../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: {
        get: () => Promise.resolve(db.settings),
        put: (s: Settings) => {
          db.settings = s;
          return Promise.resolve();
        },
      },
    }),
}));

import type { Settings } from '../../../domain/settings';
import { loadSettings, resetSettingsForTests, updateSettings } from '../../data/useSettings';
import { setLang } from '../../i18n';
import { CoachOverlay } from './CoachOverlay';
import { EffortGroup } from './EffortGroup';

const cue = { kind: 'addResistance', effort: 6, rpm: 90, inSec: 5 } as const;

beforeEach(async () => {
  db.settings = undefined;
  resetSettingsForTests();
  setLang('en');
  await loadSettings();
});
afterEach(() => setLang('en'));

describe('knob calibration in the cue and the HUD', () => {
  it('without calibration the cue and HUD are unchanged', () => {
    render(
      <>
        <CoachOverlay cue={cue} cueKey={1} color="#fff" />
        <EffortGroup effort={6} ftpPct={85} labelKey="hardTempo" />
      </>,
    );
    expect(screen.getByTestId('coach-live')).toHaveTextContent(
      'In 5 s: add resistance → effort 6, 90 rpm',
    );
    expect(screen.queryByTestId('knob-line')).toBeNull();
  });

  it('shows the calibrated knob position in the cue and the HUD', async () => {
    await updateSettings({ resistanceMode: 'knob', knobSteps: [2, 4, 6, 8, 10] });
    render(
      <>
        <CoachOverlay cue={cue} cueKey={1} color="#fff" />
        <EffortGroup effort={6} ftpPct={85} labelKey="hardTempo" />
      </>,
    );
    // E6 -> S3 (anchors S1=E3, S2=E4, S3=E6, S4=E7, S5=E9) (position 6).
    expect(screen.getByTestId('coach-live')).toHaveTextContent(
      'In 5 s: add resistance → effort 6 (knob S3 = 6), 90 rpm',
    );
    expect(screen.getByTestId('knob-line')).toHaveTextContent('Knob S3 · 6');
  });

  it('speaks Polish', async () => {
    setLang('pl');
    await updateSettings({ resistanceMode: 'knobPower', knobSteps: [2, 4, 6, 8, 10] });
    render(<CoachOverlay cue={cue} cueKey={1} color="#fff" />);
    expect(screen.getByTestId('coach-live')).toHaveTextContent(
      'Za 5 s: dodaj opór → wysiłek 6 (pokrętło S3 = 6), 90 obr/min',
    );
  });

  it('ignores calibration on a smart trainer and corrupt data', async () => {
    await updateSettings({ resistanceMode: 'smart', knobSteps: [2, 4, 6, 8, 10] });
    const { rerender } = render(<EffortGroup effort={6} ftpPct={85} labelKey="hardTempo" />);
    expect(screen.queryByTestId('knob-line')).toBeNull();
    await updateSettings({ resistanceMode: 'knob', knobSteps: [9, 1, 1, 1, 1] });
    rerender(<EffortGroup effort={6} ftpPct={85} labelKey="hardTempo" />);
    expect(screen.queryByTestId('knob-line')).toBeNull();
  });

  it('a calibration change applies to the next render', async () => {
    await updateSettings({ resistanceMode: 'knob', knobSteps: [2, 4, 6, 8, 10] });
    const { rerender } = render(<EffortGroup effort={3} ftpPct={62} labelKey="steady" />);
    expect(screen.getByTestId('knob-line')).toHaveTextContent('Knob S1 · 2');
    await updateSettings({ knobSteps: [3, 5, 7, 9, 11] });
    rerender(<EffortGroup effort={3} ftpPct={62} labelKey="steady" />);
    expect(screen.getByTestId('knob-line')).toHaveTextContent('Knob S1 · 3');
  });
});
