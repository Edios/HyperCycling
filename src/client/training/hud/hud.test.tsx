import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '../../../domain/segments';
import { CoachOverlay } from './CoachOverlay';
import { Countdown } from './Countdown';
import { EdgeFlash } from './EdgeFlash';
import { EffortGroup } from './EffortGroup';
import { fitCqw } from './fit';
import { MeasuresGroup } from './MeasuresGroup';
import { PlayersList } from './PlayersList';
import { TimeGroup } from './TimeGroup';
import { Timeline } from './Timeline';

function seg(
  p: Partial<Segment> & { index: number; startSec: number; durationSec: number },
): Segment {
  return {
    kind: 'steady',
    ftpPctStart: 70,
    ftpPctEnd: 70,
    effortStart: 4,
    effortEnd: 4,
    blockId: `b${p.index}`,
    rep: 1,
    reps: 1,
    ...p,
  };
}

describe('EffortGroup ring label', () => {
  afterEach(() => vi.restoreAllMocks());
  const width = (w: number) =>
    vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: w, height: w } as DOMRect);
  it.each([120, 180, 229])('puts no label inside a %ipx ring, a caption under it', (w) => {
    width(w);
    render(<EffortGroup effort={10} ftpPct={92} labelKey="hard" />);
    expect(screen.queryByTestId('effort-ring-word')).toBeNull();
    expect(within(screen.getByTestId('effort-ring-box')).queryByText('Effort')).toBeNull();
    expect(screen.getByTestId('effort-caption')).toHaveTextContent('Effort');
  });
  it.each([230, 300])('puts the label inside a %ipx ring, no caption', (w) => {
    width(w);
    render(<EffortGroup effort={10} ftpPct={92} labelKey="hard" />);
    expect(screen.getByTestId('effort-ring-word')).toHaveTextContent('Effort');
    expect(screen.queryByTestId('effort-caption')).toBeNull();
  });
});

describe('EffortGroup', () => {
  it('shows the ring with the value, the name and % FTP', () => {
    render(<EffortGroup effort={7} ftpPct={92} labelKey="hard" />);
    const root = screen.getByTestId('effort-value');
    expect(within(root).getByTestId('effort-ring')).toHaveAttribute('data-effort', '7');
    expect(screen.getByTestId('effort-value-number')).toHaveTextContent('07');
    expect(root).toHaveTextContent('Hard · ~92% FTP');
  });
  it('is group W', () => {
    render(<EffortGroup effort={7} ftpPct={92} labelKey="hard" />);
    expect(screen.getByTestId('effort-group')).toHaveAttribute('data-g', 'W');
  });
  it('shows NEXT as a quiet ring with its time and description', () => {
    const next = seg({
      index: 1,
      startSec: 60,
      durationSec: 180,
      effortStart: 3,
      effortEnd: 3,
      rpm: 85,
      label: 'Recovery',
    });
    render(<EffortGroup effort={7} ftpPct={92} labelKey="hard" next={next} />);
    const root = screen.getByTestId('next-block');
    expect(root).toHaveTextContent('Next');
    expect(root).toHaveTextContent('3:00');
    expect(root).toHaveTextContent('85 rpm');
    expect(root).toHaveTextContent('Recovery');
    const ring = within(root).getByTestId('effort-ring');
    expect(ring).toHaveAttribute('data-quiet', 'true');
    expect(ring).toHaveAttribute('data-effort', '3');
  });
  it('translates @token labels', () => {
    const next = seg({ index: 1, startSec: 60, durationSec: 60, label: '@recovery' });
    render(<EffortGroup effort={7} ftpPct={92} labelKey="hard" next={next} />);
    expect(screen.getByTestId('next-block')).toHaveTextContent('Recovery');
  });
  it('shows Finish when there is no next block', () => {
    render(<EffortGroup effort={7} ftpPct={92} labelKey="hard" />);
    expect(screen.getByTestId('next-block')).toHaveTextContent('Finish');
    expect(within(screen.getByTestId('next-block')).queryByTestId('effort-ring')).toBeNull();
  });
  it('is a section of a column without its own panel', () => {
    const { rerender } = render(<EffortGroup effort={7} ftpPct={92} labelKey="hard" />);
    const panel = screen.getByTestId('effort-group').className;
    rerender(<EffortGroup effort={7} ftpPct={92} labelKey="hard" section />);
    expect(screen.getByTestId('effort-group').className).not.toBe(panel);
  });
});

describe('MeasuresGroup', () => {
  it('shows the cadence and the position', () => {
    render(<MeasuresGroup rpm={90} position="seated" isTarget={false} />);
    const root = screen.getByTestId('rpm-value');
    expect(root).toHaveAttribute('data-g', 'M');
    expect(root).toHaveTextContent('90');
    expect(root).toHaveTextContent('rpm');
    expect(root).toHaveTextContent('Seated');
  });
  it('shows a dash when rpm is undefined', () => {
    render(<MeasuresGroup isTarget={false} />);
    expect(screen.getByTestId('rpm-value')).toHaveTextContent('—');
  });
  it('labels the value as the plan target when cadence is not measured', () => {
    render(<MeasuresGroup rpm={85} isTarget />);
    expect(screen.getByTestId('rpm-value')).toHaveTextContent(/target from plan/i);
  });
  it('drops the description in the bare strip', () => {
    render(<MeasuresGroup rpm={85} position="standing" isTarget bare />);
    expect(screen.getByTestId('rpm-value')).not.toHaveTextContent(/standing|target/i);
  });
});

describe('TimeGroup', () => {
  it('shows the clock and the progress as a scaled rail', () => {
    render(<TimeGroup remainingSec={150} durationSec={600} pulse={false} />);
    const root = screen.getByTestId('block-timer');
    expect(root).toHaveAttribute('data-g', 'C');
    expect(root).toHaveTextContent('2:30');
    expect(within(root).getByRole('progressbar').firstElementChild).toHaveStyle({
      transform: 'scaleX(0.25)',
    });
  });
  it('labels the progressbar', () => {
    render(<TimeGroup remainingSec={10} durationSec={60} pulse={false} />);
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Time left');
  });
  it('can hide the caption', () => {
    render(<TimeGroup remainingSec={10} durationSec={60} pulse={false} hideLabel />);
    expect(screen.getByTestId('block-timer')).not.toHaveTextContent('Time left');
  });
  it('pulses only when asked and motion is allowed', () => {
    const { rerender } = render(<TimeGroup remainingSec={4} durationSec={60} pulse />);
    expect(screen.getByTestId('block-timer').dataset['pulse']).toBe('true');
    rerender(<TimeGroup remainingSec={4} durationSec={60} pulse reducedMotion />);
    expect(screen.getByTestId('block-timer').dataset['pulse']).toBe('false');
  });
  it('guards zero duration', () => {
    render(<TimeGroup remainingSec={0} durationSec={0} pulse={false} />);
    expect(
      within(screen.getByTestId('block-timer')).getByRole('progressbar').firstElementChild,
    ).toHaveStyle({ transform: 'scaleX(0)' });
  });
});

describe('fit-to-tile sizing (Classic tiles)', () => {
  const fit = (el: HTMLElement) => el.style.getPropertyValue('--fit');
  it.each([
    [189, '50'],
    [600, '40'],
    [3599, '40'],
    [3600, '30'],
  ])('block timer %i s uses fit %s cqw', (sec, expected) => {
    render(<TimeGroup remainingSec={sec} durationSec={3600} pulse={false} fit />);
    expect(fit(screen.getByTestId('block-timer-value'))).toBe(expected);
  });
  it('shrinks as the character count grows', () => {
    const sizes = [2, 4, 5, 7].map((n) => Number(fitCqw(n)));
    expect(sizes).toEqual([60, 50, 40, 30]);
  });
  it('cadence value is sized by its digits', () => {
    render(<MeasuresGroup rpm={90} isTarget={false} fit />);
    expect(fit(screen.getByTestId('rpm-value-number'))).toBe('60');
  });
  it('sizes nothing without fit (overlay panels are shrink-wrapped)', () => {
    render(<TimeGroup remainingSec={150} durationSec={600} pulse={false} />);
    expect(fit(screen.getByTestId('block-timer-value'))).toBe('');
  });
});

describe('Timeline', () => {
  const segments = [
    seg({ index: 0, startSec: 0, durationSec: 60, effortStart: 3, effortEnd: 3 }),
    seg({ index: 1, startSec: 60, durationSec: 120, kind: 'ramp', effortStart: 4, effortEnd: 8 }),
    seg({ index: 2, startSec: 180, durationSec: 60, effortStart: 9, effortEnd: 9 }),
  ];
  it('marks past, current and future bars', () => {
    render(<Timeline segments={segments} elapsedSec={90} />);
    const bars = screen.getByTestId('timeline').querySelectorAll('[data-state]');
    expect(bars).toHaveLength(3);
    expect(bars[0]?.className).toMatch(/past/);
    expect(bars[1]?.className).toMatch(/current/);
    expect(bars[2]?.className).not.toMatch(/past|current/);
    expect(bars[0]?.getAttribute('data-state')).toBe('past');
    expect(bars[1]?.getAttribute('data-state')).toBe('current');
  });
  it('sizes bars by duration and positions the cursor', () => {
    render(<Timeline segments={segments} elapsedSec={120} />);
    const root = screen.getByTestId('timeline');
    const bars = root.querySelectorAll<HTMLElement>('[data-state]');
    expect(bars[1]?.style.flexGrow).toBe('120');
    expect(root.querySelector<HTMLElement>('[data-cursor]')?.style.left).toBe('50%');
  });
  it('draws ramps with a clip-path slope', () => {
    render(<Timeline segments={segments} elapsedSec={0} />);
    const bars = screen.getByTestId('timeline').querySelectorAll('[data-state]');
    expect(bars[1]?.querySelector<HTMLElement>('[data-fill]')?.style.clipPath).toContain('polygon');
  });
  it('shows elapsed / total and remaining', () => {
    render(<Timeline segments={segments} elapsedSec={90} />);
    const root = screen.getByTestId('timeline');
    expect(root).toHaveTextContent('1:30 / 4:00');
    expect(root).toHaveTextContent('2:30');
    expect(root).toHaveTextContent(/remaining/i);
  });
  it('is group P and carries the workout name and "block n of m"', () => {
    render(<Timeline segments={segments} elapsedSec={90} blockIndex={1} title="Demo mix" />);
    const root = screen.getByTestId('timeline');
    expect(root).toHaveAttribute('data-g', 'P');
    expect(root).toHaveTextContent('Demo mix');
    expect(screen.getByTestId('block-counter')).toHaveTextContent('block 2 of 3');
  });
  it('keeps only the block and the time left on the thin floor', () => {
    render(<Timeline segments={segments} elapsedSec={90} blockIndex={1} title="Demo mix" mini />);
    const root = screen.getByTestId('timeline');
    expect(root).not.toHaveTextContent('Demo mix');
    expect(root).not.toHaveTextContent('1:30 / 4:00');
    expect(root).toHaveTextContent('block 2 of 3');
    expect(root).toHaveTextContent('remaining 2:30');
  });
  it('treats non-finite elapsed as 0', () => {
    render(<Timeline segments={segments} elapsedSec={Number.NaN} />);
    const root = screen.getByTestId('timeline');
    expect(root.querySelector<HTMLElement>('[data-cursor]')?.style.left).toBe('0%');
    expect(root).toHaveTextContent('0:00 / 4:00');
  });
  it('clamps the cursor after the end', () => {
    render(<Timeline segments={segments} elapsedSec={9999} />);
    expect(
      screen.getByTestId('timeline').querySelector<HTMLElement>('[data-cursor]')?.style.left,
    ).toBe('100%');
  });
});

describe('PlayersList', () => {
  const players = [
    { id: 'a', name: 'Ann', ftp: 200 },
    { id: 'b', name: 'Bob', ftp: 255, isMe: true },
  ];
  it('shows target watts per player', () => {
    render(<PlayersList players={players} ftpPct={92} effort={6} showsWatts />);
    const root = screen.getByTestId('players-list');
    expect(root).toHaveTextContent('Target for block · ~92% FTP');
    expect(root).toHaveTextContent('Ann');
    expect(root).toHaveTextContent('FTP 200 W');
    expect(root).toHaveTextContent('184 W');
    expect(root).toHaveTextContent('235 W');
  });
  it('shows a dash instead of throwing on invalid ftp', () => {
    const bad = [
      { id: 'x', name: 'Zero', ftp: 0 },
      { id: 'y', name: 'Nan', ftp: Number.NaN },
    ];
    render(<PlayersList players={bad} ftpPct={92} effort={6} showsWatts />);
    const root = screen.getByTestId('players-list');
    expect(root).toHaveTextContent('Zero');
    expect(root.textContent?.match(/—/g)).toHaveLength(4);
    expect(screen.getAllByText('FTP —')).toHaveLength(2);
  });
  it('shows names only when the bike has no watts', () => {
    render(<PlayersList players={players} ftpPct={92} effort={6} showsWatts={false} />);
    const root = screen.getByTestId('players-list');
    expect(root).toHaveTextContent('Ann');
    expect(root).not.toHaveTextContent(/\bW\b/);
  });
  it('without watts shows the block effort once on the 1-10 scale and no % FTP per row', () => {
    render(<PlayersList players={players} ftpPct={92} effort={6} showsWatts={false} />);
    const root = screen.getByTestId('players-list');
    expect(root).toHaveTextContent('Target for block · effort 6/10');
    expect(root).not.toHaveTextContent('FTP');
    const rows = root.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/^Ann$/);
    expect(rows[1]).toHaveTextContent(/^Bob$/);
  });
});

describe('CoachOverlay', () => {
  it('renders nothing visible without a cue but keeps the live region mounted', () => {
    render(<CoachOverlay cue={null} cueKey={0} color="#fff" />);
    expect(screen.queryByTestId('coach-overlay')).toBeNull();
    expect(screen.getByTestId('coach-live')).toHaveAttribute('aria-live', 'polite');
  });
  it('announces the cue in an sr-only polite live region; the big visual text is hidden from AT', () => {
    const { rerender } = render(<CoachOverlay cue={null} cueKey={0} color="#fff" />);
    const live = screen.getByTestId('coach-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveClass('sr-only');
    expect(live).toBeEmptyDOMElement();
    rerender(<CoachOverlay cue={{ kind: 'attack' }} cueKey={1} color="#fff" />);
    expect(live).toHaveTextContent('ATTACK!');
    expect(screen.getByTestId('coach-overlay')).toHaveAttribute('aria-hidden', 'true');
    expect(live).not.toContainElement(screen.getByTestId('coach-overlay'));
  });
  it('re-announces an identical cue (the announced node is replaced per cueKey)', () => {
    const { rerender } = render(<CoachOverlay cue={{ kind: 'attack' }} cueKey={1} color="#fff" />);
    const first = screen.getByTestId('coach-live').firstElementChild;
    rerender(<CoachOverlay cue={{ kind: 'attack' }} cueKey={2} color="#fff" />);
    expect(screen.getByTestId('coach-live').firstElementChild).not.toBe(first);
  });
  it('translates @token custom cues', () => {
    render(<CoachOverlay cue={{ kind: 'custom', text: '@sprint' }} cueKey={1} color="#fff" />);
    expect(screen.getByTestId('coach-overlay')).toHaveTextContent('Sprint!');
  });
  it.each([
    [{ kind: 'attack' } as const, 'ATTACK!'],
    [{ kind: 'standUp' } as const, 'Stand up!'],
    [{ kind: 'sitDown' } as const, 'Sit down'],
    [{ kind: 'cadence', rpm: 100 } as const, 'Cadence 100!'],
    [{ kind: 'custom', text: 'Smile' } as const, 'Smile'],
  ])('translates %j', (cue, text) => {
    render(<CoachOverlay cue={cue} cueKey={1} color="#fff" />);
    expect(screen.getByTestId('coach-overlay')).toHaveTextContent(text);
  });
  it('has distinct texts for relative cadence cues', () => {
    const { rerender } = render(
      <CoachOverlay cue={{ kind: 'cadenceUp' }} cueKey={1} color="#fff" />,
    );
    const up = screen.getByTestId('coach-overlay').textContent;
    rerender(<CoachOverlay cue={{ kind: 'cadenceDown' }} cueKey={2} color="#fff" />);
    expect(screen.getByTestId('coach-overlay').textContent).not.toBe(up);
  });
  it('disables animation under reduced motion', () => {
    render(<CoachOverlay cue={{ kind: 'attack' }} cueKey={1} color="#fff" reducedMotion />);
    expect(screen.getByTestId('coach-overlay').dataset['animated']).toBe('false');
  });
});

describe('Countdown', () => {
  it('renders the number', () => {
    render(<Countdown n={2} color="#fff" />);
    expect(screen.getByTestId('countdown')).toHaveTextContent('2');
  });
  it('renders nothing when null', () => {
    render(<Countdown n={null} color="#fff" />);
    expect(screen.queryByTestId('countdown')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('hides the visual from assistive tech and announces politely', () => {
    render(<Countdown n={3} color="#fff" />);
    expect(screen.getByTestId('countdown')).toHaveAttribute('aria-hidden', 'true');
    const live = screen.getByRole('status');
    expect(live).toHaveTextContent('3');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });
});

describe('EdgeFlash', () => {
  it('animates on trigger and stays idle at 0', () => {
    const { rerender } = render(<EdgeFlash trigger={0} color="#f00" />);
    expect(screen.getByTestId('edge-flash').dataset['active']).toBe('false');
    rerender(<EdgeFlash trigger={1} color="#f00" />);
    expect(screen.getByTestId('edge-flash').dataset['active']).toBe('true');
  });
  it('never animates under reduced motion', () => {
    render(<EdgeFlash trigger={3} color="#f00" reducedMotion />);
    expect(screen.getByTestId('edge-flash').dataset['active']).toBe('false');
  });
});
