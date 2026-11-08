import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { chainChoices } from './musicMatch';
import { builtinExperiences, getWorkout } from '../data/builtin';
import { getMusicSource, setMusicSource } from '../music/music-source';
import type { PreflightDeps, RecordingResult } from '../music/preflight';
import { ExperienceMusicCheck, redSlots } from './ExperienceMusicCheck';

const exp = builtinExperiences.find((e) => e.id === 'neon-grid-45')!;
const workout = getWorkout('class-neon-grid-45')!;
const chains = chainChoices(workout, exp, {}, { source: 'youtube', spotifyUsable: false });

// First slot is Nightcall: MV_3Dpw-BRY, 46qo_V1zcOM, ahienBeHUWw, Gl8SUy1C9JY.
const NIGHTCALL = ['MV_3Dpw-BRY', '46qo_V1zcOM', 'ahienBeHUWw', 'Gl8SUy1C9JY'];

function mount(deps: PreflightDeps, spotifyConnected = false) {
  const seen: Map<string, RecordingResult>[] = [];
  function Host() {
    return (
      <MemoryRouter>
        <ExperienceMusicCheck
          experience={exp}
          workout={workout}
          chains={chains}
          results={seen.at(-1) ?? new Map()}
          onResults={(r) => {
            seen.push(new Map(r));
            rerender();
          }}
          spotifyConnected={spotifyConnected}
          deps={deps}
        />
      </MemoryRouter>
    );
  }
  const { rerender: rr } = render(<Host />);
  function rerender() {
    rr(<Host />);
  }
  return seen;
}

beforeEach(() => localStorage.clear());

describe('ExperienceMusicCheck', () => {
  it('says the music was not checked yet and offers the check', () => {
    mount({});
    expect(screen.getByTestId('exp-check-notrun')).toBeTruthy();
    expect(screen.getByTestId('exp-check-run')).toBeTruthy();
    expect(screen.queryByTestId('exp-check-list')).toBeNull();
  });

  it('shows every slot green when all uploads play, with no block', async () => {
    mount({ oembed: async () => ({ status: 'ok' }), probe: async () => ({ kind: 'playing' }) });
    fireEvent.click(screen.getByTestId('exp-check-run'));
    const list = await screen.findByTestId('exp-check-list');
    const slots = within(list).getAllByTestId('exp-check-slot');
    expect(slots).toHaveLength(11);
    expect(slots.every((s) => s.getAttribute('data-health') === 'green')).toBe(true);
    expect(screen.queryByTestId('exp-check-blocked')).toBeNull();
  });

  it('a dead main upload is yellow ("backup only"), still no block', async () => {
    mount({
      oembed: async (id) => ({ status: id === NIGHTCALL[0] ? 'blocked' : 'ok' }),
      probe: async () => ({ kind: 'playing' }),
    });
    fireEvent.click(screen.getByTestId('exp-check-run'));
    const list = await screen.findByTestId('exp-check-list');
    const first = within(list).getAllByTestId('exp-check-slot')[0]!;
    expect(first.getAttribute('data-health')).toBe('yellow');
    expect(first.textContent).toMatch(/3 .* 4/);
    expect(screen.queryByTestId('exp-check-blocked')).toBeNull();
  });

  it('a slot where nothing plays is red, blocks and points to Spotify', async () => {
    mount({
      oembed: async () => ({ status: 'ok' }),
      probe: async (id) =>
        NIGHTCALL.includes(id) ? { kind: 'error', code: 150 } : { kind: 'playing' },
    });
    fireEvent.click(screen.getByTestId('exp-check-run'));
    const list = await screen.findByTestId('exp-check-list');
    const slots = within(list).getAllByTestId('exp-check-slot');
    // Nightcall is slot 1 and slot 8 of Neon Grid 45.
    expect(slots[0]!.getAttribute('data-health')).toBe('red');
    expect(slots[7]!.getAttribute('data-health')).toBe('red');
    const blocked = screen.getByTestId('exp-check-blocked');
    expect(blocked.textContent).toMatch(/1, 8/);
    expect(blocked.getAttribute('role')).toBe('alert');
    expect(within(blocked).queryByTestId('exp-check-spotify')).toBeNull(); // not connected: a link
    expect(within(blocked).getByRole('link')).toBeTruthy();
  });

  it('with Spotify connected, the block offers switching the source', async () => {
    setMusicSource('youtube');
    mount(
      {
        oembed: async () => ({ status: 'ok' }),
        probe: async (id) =>
          NIGHTCALL.includes(id) ? { kind: 'error', code: 101 } : { kind: 'playing' },
      },
      true,
    );
    fireEvent.click(screen.getByTestId('exp-check-run'));
    const button = await screen.findByTestId('exp-check-spotify');
    fireEvent.click(button);
    expect(getMusicSource()).toBe('spotify');
  });

  it('remembers dead recordings on this device for the next ride', async () => {
    mount({
      oembed: async (id) => ({ status: id === NIGHTCALL[0] ? 'missing' : 'ok' }),
      probe: async () => ({ kind: 'playing' }),
    });
    fireEvent.click(screen.getByTestId('exp-check-run'));
    await waitFor(() => expect(screen.getByTestId('exp-check-list')).toBeTruthy());
    expect(localStorage.getItem('hypercycling.music.check')).toContain(`youtube:${NIGHTCALL[0]}`);
  });
});

describe('redSlots', () => {
  it('is empty until a check ran', () => {
    expect(redSlots(exp, workout, chains, new Map())).toEqual([]);
  });
});
