import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { builtinExperiences, getWorkout } from '../data/builtin';
import { SpotifyError, type SpotifyProvider, type SpotifyTrackHit } from '../music/spotify';
import { ExperienceMusic } from './ExperienceMusic';
import { loadChoices, type Choices } from './musicChoices';

const exp = builtinExperiences.find((e) => e.id === 'neon-grid-45')!;
const workout = getWorkout('class-neon-grid-45')!;

function hit(
  id: string,
  title: string,
  artist: string,
  extra: Partial<SpotifyTrackHit> = {},
  durationSec = 600,
): SpotifyTrackHit {
  return {
    ref: { provider: 'spotify', id, title, artist, durationSec, startAtSec: 0 },
    explicit: false,
    playable: true,
    ...extra,
  };
}

function providerFor(
  answer: (q: string) => SpotifyTrackHit[] | Promise<SpotifyTrackHit[]>,
): SpotifyProvider {
  return { searchTracks: vi.fn(async (q: string) => answer(q)) } as unknown as SpotifyProvider;
}

/** Everything is found, long enough for every slot. */
const everything = (q: string): SpotifyTrackHit[] => {
  const m = /^track:(.*) artist:(.*)$/.exec(q)!;
  return [hit(`id${m[1]!.replace(/\W/g, '').padEnd(10, 'x').slice(0, 10)}`, m[1]!, m[2]!)];
};

function setup(opts: {
  connected?: boolean;
  provider?: SpotifyProvider;
  choices?: Choices;
  onChoices?: (c: Choices) => void;
}) {
  const onChoices = opts.onChoices ?? vi.fn();
  render(
    <MemoryRouter>
      <ExperienceMusic
        experience={exp}
        workout={workout}
        connected={opts.connected ?? true}
        choices={opts.choices ?? {}}
        onChoices={onChoices}
        {...(opts.provider ? { provider: opts.provider } : {})}
      />
    </MemoryRouter>,
  );
  return onChoices;
}

beforeEach(() => localStorage.clear());

describe('ExperienceMusic', () => {
  it('without Spotify shows the connect link and no match button', () => {
    setup({ connected: false });
    expect(screen.getByTestId('exp-music-connect').getAttribute('href')).toBe('/settings');
    expect(screen.queryByTestId('exp-music-match')).toBeNull();
  });

  it('matches, shows the list and saves the approved songs locally', async () => {
    const onChoices = setup({ provider: providerFor(everything) });
    fireEvent.click(screen.getByTestId('exp-music-match'));
    const list = await screen.findByTestId('exp-music-review');
    expect(within(list).getAllByTestId('exp-music-row')).toHaveLength(11);
    fireEvent.click(screen.getByTestId('exp-music-approve'));
    expect(onChoices).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(onChoices).mock.calls[0]![0];
    expect(Object.keys(saved)).toHaveLength(11);
    expect(Object.keys(loadChoices(exp.id))).toHaveLength(11);
  });

  it('saves nothing when the list is rejected', async () => {
    const onChoices = setup({ provider: providerFor(everything) });
    fireEvent.click(screen.getByTestId('exp-music-match'));
    await screen.findByTestId('exp-music-review');
    fireEvent.click(screen.getByTestId('exp-music-reject'));
    expect(onChoices).not.toHaveBeenCalled();
    expect(loadChoices(exp.id)).toEqual({});
    expect(screen.getByTestId('exp-music-match')).toBeTruthy();
  });

  it('marks songs with no result as missing', async () => {
    setup({ provider: providerFor(() => []) });
    fireEvent.click(screen.getByTestId('exp-music-match'));
    await screen.findByTestId('exp-music-review');
    const items = screen.getAllByTestId('exp-music-item');
    expect(items.length).toBeGreaterThanOrEqual(11);
    expect(items.every((i) => i.getAttribute('data-how') === 'missing')).toBe(true);
  });

  it('stands in a reserve song when the first one is not playable in the region', async () => {
    setup({
      provider: providerFor((q) =>
        q.includes('Kavinsky')
          ? [hit('nc000000000', 'Nightcall', 'Kavinsky', { playable: false })]
          : everything(q),
      ),
    });
    fireEvent.click(screen.getByTestId('exp-music-match'));
    await screen.findByTestId('exp-music-review');
    const first = screen.getAllByTestId('exp-music-row')[0]!;
    const item = within(first).getAllByTestId('exp-music-item')[0]!;
    expect(item.getAttribute('data-how')).toBe('replaced');
    expect(item.textContent).toMatch(/Faded/); // 90 BPM is nearest to Nightcall's 91
  });

  it('shows "region not verified" when Spotify sent no availability', async () => {
    setup({
      provider: providerFor((q) => everything(q).map((h) => ({ ...h, playable: undefined }))),
    });
    fireEvent.click(screen.getByTestId('exp-music-match'));
    await screen.findByTestId('exp-music-review');
    expect(screen.getAllByTestId('exp-music-region').length).toBeGreaterThanOrEqual(11);
  });

  it('shows no region note when availability is known', async () => {
    setup({ provider: providerFor(everything) });
    fireEvent.click(screen.getByTestId('exp-music-match'));
    await screen.findByTestId('exp-music-review');
    expect(screen.queryByTestId('exp-music-region')).toBeNull();
  });

  it('keeps manual changes in the advanced section: removing a song leaves that slot empty', async () => {
    const onChoices = setup({ provider: providerFor(everything) });
    fireEvent.click(screen.getByTestId('exp-music-match'));
    await screen.findByTestId('exp-music-review');
    const first = screen.getAllByTestId('exp-music-row')[0]!;
    fireEvent.click(within(first).getAllByTestId('exp-music-edit-remove')[0]!);
    fireEvent.click(screen.getByTestId('exp-music-approve'));
    const saved = vi.mocked(onChoices).mock.calls[0]![0];
    expect(saved[workout.songs![0]!.id]).toBeUndefined();
    expect(Object.keys(saved)).toHaveLength(10);
  });

  it('saves the authored queue of two songs for a slot, in order', async () => {
    const onChoices = setup({ provider: providerFor(everything) });
    fireEvent.click(screen.getByTestId('exp-music-match'));
    await screen.findByTestId('exp-music-review');
    fireEvent.click(screen.getByTestId('exp-music-approve'));
    const saved = vi.mocked(onChoices).mock.calls[0]![0];
    expect(saved[workout.songs![9]!.id]?.map((x: { title: string }) => x.title)).toEqual([
      'Basket Case',
      'Tidal Wave',
    ]);
  });

  it('warns when a song is shorter than its slot', async () => {
    setup({
      provider: providerFor((q) =>
        everything(q).map((h) => ({ ...h, ref: { ...h.ref, durationSec: 100 } })),
      ),
    });
    fireEvent.click(screen.getByTestId('exp-music-match'));
    await screen.findByTestId('exp-music-review');
    const msgs = screen.getAllByTestId('exp-music-queue-status').map((e) => e.textContent);
    expect(msgs.some((m) => /Brakuje|Missing/.test(m ?? ''))).toBe(true);
  });

  it('shows an error and no list when there is no token', async () => {
    setup({ provider: providerFor(() => Promise.reject(new SpotifyError('notAuthorized'))) });
    fireEvent.click(screen.getByTestId('exp-music-match'));
    const err = await screen.findByTestId('exp-music-error');
    expect(err.textContent).toMatch(/Spotify/);
    expect(screen.queryByTestId('exp-music-review')).toBeNull();
    fireEvent.click(screen.getByText(/Jedź bez tych utworów|Ride without these songs/));
    await waitFor(() => expect(screen.getByTestId('exp-music-match')).toBeTruthy());
  });

  it('warns that the same song is suggested for parts 1 and 8', () => {
    setup({});
    expect(screen.getByTestId('exp-music-duplicate').textContent).toMatch(/1.*8/);
  });

  it('reports the saved state and clears it', () => {
    const track = {
      provider: 'spotify',
      id: 'nc000000000',
      title: 'Nightcall',
      startAtSec: 0,
    } as const;
    const onChoices = setup({ choices: { [workout.songs![0]!.id]: [track] } });
    expect(screen.getByTestId('exp-music-state').textContent).toMatch(/1/);
    fireEvent.click(screen.getByTestId('exp-music-clear'));
    expect(onChoices).toHaveBeenCalledWith({});
  });
});
