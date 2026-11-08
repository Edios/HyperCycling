import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanCandidate } from '../../domain/slot-plan';
import type { TrackRef } from '../../domain/workout';
import { SlotQueue } from './SlotQueue';

const tr = (id: string, title: string, durationSec: number, startAtSec = 0): TrackRef => ({
  provider: 'spotify',
  id,
  title,
  artist: 'A',
  durationSec,
  startAtSec,
});
const cand = (track: TrackRef, origin: 'main' | 'alt' = 'alt'): PlanCandidate => ({
  track,
  origin,
  playable: true,
});

describe('SlotQueue', () => {
  it('shows the total and a warning with the missing time and tempo', () => {
    render(
      <SlotQueue tracks={[tr('a', 'One', 200)]} slotSec={360} targetBpm={174} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId('slot-queue-total').textContent).toMatch(/3:20.*6:00/);
    expect(screen.getByTestId('slot-queue-status').textContent).toMatch(/2:40.*174/);
  });

  it('allows silence in a rest and says the last song fades when over', () => {
    const { rerender } = render(
      <SlotQueue tracks={[tr('a', 'One', 100)]} slotSec={300} rest onChange={vi.fn()} />,
    );
    expect(screen.getByTestId('slot-queue-status').getAttribute('role')).toBeNull();
    rerender(<SlotQueue tracks={[tr('a', 'One', 400)]} slotSec={300} onChange={vi.fn()} />);
    expect(screen.getByTestId('slot-queue-status').textContent).toMatch(/1:40/);
  });

  it('reorders, removes and sets the start offset', () => {
    const onChange = vi.fn();
    const a = tr('a', 'One', 200);
    const b = tr('b', 'Two', 200);
    render(<SlotQueue tracks={[a, b]} slotSec={400} onChange={onChange} />);
    fireEvent.click(screen.getAllByTestId('slot-queue-down')[0]!);
    expect(onChange).toHaveBeenLastCalledWith([b, a]);
    fireEvent.click(screen.getAllByTestId('slot-queue-remove')[1]!);
    expect(onChange).toHaveBeenLastCalledWith([a]);
    fireEvent.change(screen.getAllByTestId('slot-queue-offset')[0]!, { target: { value: '15' } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...a, startAtSec: 15 }, b]);
  });

  it('swaps in a longer version and adds from reserve only on request', () => {
    const onChange = vi.fn();
    const radio = tr('r', 'Song - Radio Edit', 200);
    const album = tr('al', 'Song', 340);
    const other = tr('o', 'Other', 180);
    render(
      <SlotQueue
        tracks={[radio]}
        slotSec={360}
        candidates={[cand(radio, 'main'), cand(album, 'main'), cand(other)]}
        onChange={onChange}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('slot-queue-longer'));
    expect(onChange).toHaveBeenLastCalledWith([album]);
    fireEvent.click(screen.getByTestId('slot-queue-reserve'));
    expect(onChange).toHaveBeenLastCalledWith([radio, other]);
  });
});
