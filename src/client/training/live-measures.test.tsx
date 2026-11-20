import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LiveSnapshot } from '../devices/live-metrics';
import { OFF_SNAPSHOT } from '../devices/live-metrics';
import { setLang } from '../i18n';
import { hasMeasures, MeasuresGroup } from './hud/MeasuresGroup';
import { buildLiveMeasures, worstLink, type LiveContext } from './live-measures';

const ctx: LiveContext = { showsWatts: true, targetW: 200, targetRpm: 90, hrMax: 190 };
const live = (over: Partial<LiveSnapshot>): LiveSnapshot => ({ ...OFF_SNAPSHOT, ...over });

beforeEach(() => setLang('en'));

describe('buildLiveMeasures', () => {
  it('is undefined without sensors', () => {
    expect(buildLiveMeasures(OFF_SNAPSHOT, ctx)).toBeUndefined();
  });

  it('builds power, cadence and heart rate rows with targets and judgements', () => {
    expect(
      buildLiveMeasures(
        live({
          trainer: 'live',
          hr: 'live',
          powerW: 210,
          cadenceRpm: 82,
          hrBpm: 160,
          hrContact: 'ok',
        }),
        ctx,
      ),
    ).toEqual({
      signal: 'live',
      power: { watts: 210, target: 200 },
      cadence: { rpm: 82, target: 90, judgement: 'low', band: { low: 85, high: 95 } },
      hr: { bpm: 160, zone: 4, noContact: false },
    });
  });

  it('no power row for a bike that does not show watts; no target without one', () => {
    const m = buildLiveMeasures(live({ trainer: 'live', cadenceRpm: 90 }), {
      ...ctx,
      showsWatts: false,
      targetRpm: undefined,
    });
    expect(m).toEqual({
      signal: 'live',
      cadence: { rpm: 90, target: null, judgement: null },
    });
  });

  it('keeps the rows (with missing values) while a link is silent or reconnecting', () => {
    const m = buildLiveMeasures(live({ trainer: 'reconnecting', hr: 'stale' }), ctx);
    expect(m).toMatchObject({
      signal: 'reconnecting',
      power: { watts: null },
      cadence: { rpm: null, judgement: null },
      hr: { bpm: null, zone: null },
    });
  });

  it('orders link severity: lost > reconnecting > stale > live > off', () => {
    expect(worstLink('live', 'off')).toBe('live');
    expect(worstLink('stale', 'live')).toBe('stale');
    expect(worstLink('stale', 'reconnecting')).toBe('reconnecting');
    expect(worstLink('lost', 'reconnecting')).toBe('lost');
  });
});

describe('MeasuresGroup with live sensors', () => {
  it('shows power, cadence and heart rate with their targets and zone', () => {
    const m = buildLiveMeasures(
      live({
        trainer: 'live',
        hr: 'live',
        powerW: 205,
        cadenceRpm: 97,
        hrBpm: 160,
        hrContact: 'ok',
      }),
      ctx,
    )!;
    render(<MeasuresGroup rpm={90} isTarget={false} live={m} />);
    const group = screen.getByTestId('rpm-value');
    expect(group).toHaveAttribute('data-rows', '3');
    expect(group).toHaveAttribute('data-signal', 'live');
    expect(screen.getByTestId('live-power')).toHaveTextContent('205');
    expect(group).toHaveTextContent('target 200 W');
    expect(screen.getByTestId('rpm-value-number')).toHaveTextContent('97');
    expect(group).toHaveTextContent('target 90 · Pedal slower');
    expect(screen.getByTestId('live-hr')).toHaveTextContent('160');
    expect(screen.getByTestId('live-hr-zone')).toHaveTextContent('Z4');
    expect(screen.queryByTestId('live-signal')).not.toBeInTheDocument();
  });

  it('shows "—" (never 0) and a signal line while a sensor is silent', () => {
    const m = buildLiveMeasures(live({ trainer: 'stale', hr: 'live', hrBpm: 120 }), ctx)!;
    render(<MeasuresGroup rpm={90} isTarget={false} live={m} />);
    expect(screen.getByTestId('live-power')).toHaveTextContent('—');
    expect(screen.getByTestId('rpm-value-number')).toHaveTextContent('—');
    expect(screen.getByTestId('live-signal')).toHaveTextContent('No signal');
  });

  it('says when the strap is not touching skin; Polish labels', () => {
    setLang('pl');
    const m = buildLiveMeasures(live({ hr: 'live', hrContact: 'none' }), ctx)!;
    render(<MeasuresGroup isTarget={false} live={m} />);
    const group = screen.getByTestId('rpm-value');
    expect(within(group).getByTestId('live-hr')).toHaveTextContent('—');
    expect(group).toHaveTextContent('Pas nie dotyka skóry');
    expect(group).toHaveTextContent('Tętno');
  });

  it('bare strip drops notes; the cadence row can be hidden', () => {
    const m = buildLiveMeasures(live({ trainer: 'live', powerW: 100, cadenceRpm: 80 }), ctx)!;
    render(<MeasuresGroup rpm={90} isTarget={false} live={m} bare cadence={false} />);
    expect(screen.queryByTestId('rpm-value-number')).not.toBeInTheDocument();
    expect(screen.getByTestId('rpm-value')).not.toHaveTextContent('target');
  });

  it('hasMeasures: plain cadence target, or any live row', () => {
    expect(hasMeasures(undefined, true, undefined)).toBe(false);
    expect(hasMeasures(90, false, undefined)).toBe(false);
    expect(hasMeasures(90, true, undefined)).toBe(true);
    const hrOnly = buildLiveMeasures(live({ hr: 'live', hrBpm: 100 }), ctx);
    expect(hasMeasures(undefined, true, hrOnly)).toBe(true);
    const cadenceOnly = buildLiveMeasures(live({ trainer: 'live' }), { ...ctx, showsWatts: false });
    expect(hasMeasures(undefined, false, cadenceOnly)).toBe(false);
    expect(hasMeasures(undefined, true, cadenceOnly)).toBe(true);
  });
});

describe('range bars (D22)', () => {
  it('cadence and HR rows draw a bar for their target range; no marker without a value', () => {
    const m = buildLiveMeasures(
      live({ trainer: 'live', hr: 'live', cadenceRpm: 92, hrBpm: 150, hrContact: 'ok' }),
      { ...ctx, hrBand: { low: 133, high: 152 } },
    )!;
    render(<MeasuresGroup rpm={90} isTarget={false} live={m} />);
    expect(screen.getByTestId('cadence-bar')).toHaveAttribute('data-in', 'true');
    expect(screen.getByTestId('cadence-bar')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('hr-bar')).toHaveAttribute('data-in', 'true');
  });

  it('a value outside the band, and no band without a target', () => {
    const m = buildLiveMeasures(live({ trainer: 'live', cadenceRpm: 70 }), {
      ...ctx,
      showsWatts: false,
    })!;
    const { unmount } = render(<MeasuresGroup rpm={90} isTarget={false} live={m} />);
    expect(screen.getByTestId('cadence-bar')).toHaveAttribute('data-in', 'false');
    expect(screen.queryByTestId('hr-bar')).not.toBeInTheDocument();
    unmount();
    const none = buildLiveMeasures(live({ trainer: 'live' }), { ...ctx, targetRpm: undefined })!;
    render(<MeasuresGroup isTarget={false} live={none} />);
    expect(screen.queryByTestId('cadence-bar')).not.toBeInTheDocument();
  });
});
