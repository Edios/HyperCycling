import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLibraryStore,
  setLibraryStoreForTests,
  toTrackRef,
  type LibraryTrack,
} from '../music/library/library';
import { SuggestedChips } from './SuggestedChips';

function memStore(tracks: LibraryTrack[]) {
  const store = createLibraryStore(undefined);
  store.set(tracks);
  setLibraryStoreForTests(store);
  return store;
}

afterEach(() => setLibraryStoreForTests());

const lib: LibraryTrack[] = [
  { id: 'half', title: 'Slow one', artist: 'B', bpm: 90, bpmSource: 'deezer' },
  { id: 'exact', title: 'Fast one', artist: 'A', bpm: 180, bpmSource: 'getsongbpm' },
  { id: 'typed', title: 'Close one', bpm: 186, bpmSource: 'manual' },
  { id: 'none', title: 'Untagged' },
  { id: 'far', title: 'Far', bpm: 130, bpmSource: 'deezer' },
];

describe('SuggestedChips', () => {
  it('lists fitting songs best first with tempo, source and fit, and hands the pick over', () => {
    memStore(lib);
    const onPick = vi.fn();
    render(<SuggestedChips rpm={90} onPick={onPick} />);
    const chips = screen.getAllByTestId('suggested-chip');
    expect(chips.map((c) => c.textContent)).toEqual([
      'Fast one · A180 BPM · GetSongBPM · fits',
      'Slow one · B90 BPM · Deezer · half time',
      'Close one186 BPM · typed · fits (close)',
    ]);
    fireEvent.click(chips[0] as HTMLElement);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'exact', bpm: 180 }));
    // The pin the caller builds carries the tempo and where it came from.
    expect(toTrackRef(onPick.mock.calls[0]?.[0] as LibraryTrack, 12)).toMatchObject({
      provider: 'spotify',
      id: 'exact',
      bpm: 180,
      bpmSource: 'getsongbpm',
      startAtSec: 12,
    });
  });

  it('points at Settings when the library is empty and says so when nothing fits', () => {
    memStore([]);
    const { rerender } = render(<SuggestedChips rpm={90} onPick={vi.fn()} />);
    expect(screen.getByTestId('suggested-empty')).toBeInTheDocument();
    memStore([{ id: 'x', title: 'Far', bpm: 130, bpmSource: 'deezer' }]);
    rerender(<SuggestedChips rpm={85} onPick={vi.fn()} />);
    expect(screen.getByTestId('suggested-none')).toHaveTextContent('85');
  });

  it('shows nothing for a block without a cadence', () => {
    memStore(lib);
    const { container } = render(<SuggestedChips rpm={undefined} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
