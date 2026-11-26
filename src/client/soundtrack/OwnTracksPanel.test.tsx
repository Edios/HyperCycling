import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ records: new Map<string, unknown>() }));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      ownTracks: {
        list: () => Promise.resolve([...db.records.values()]),
        put: (r: { id: string }) => {
          db.records.set(r.id, r);
          return Promise.resolve();
        },
        remove: (id: string) => {
          db.records.delete(id);
          return Promise.resolve();
        },
      },
    }),
}));

import { setLang } from '../i18n';
import { OwnTracksPanel, parseLength } from './OwnTracksPanel';
import { resetOwnTracksForTests } from './own-tracks';

beforeEach(() => {
  db.records.clear();
  resetOwnTracksForTests();
  setLang('en');
});
afterEach(cleanup);

function fill(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

describe('parseLength', () => {
  it('reads m:ss and plain seconds', () => {
    expect(parseLength('3:45')).toBe(225);
    expect(parseLength('245')).toBe(245);
    expect(parseLength('3.45')).toBeUndefined();
    expect(parseLength('3:75')).toBeUndefined();
  });
});

describe('OwnTracksPanel', () => {
  it('checks the form, adds a song, lists it and turns "use my songs" on', async () => {
    const onUse = vi.fn();
    render(<OwnTracksPanel use={false} onUseChange={onUse} />);
    fireEvent.click(screen.getByRole('button', { name: /My songs/ }));
    expect(screen.getByRole('switch', { name: 'Use my songs' })).toBeDisabled();
    fill('soundtrack-own-link', 'not a link');
    fill('soundtrack-own-bpm', '400');
    fireEvent.click(screen.getByTestId('soundtrack-own-add'));
    expect(await screen.findByText('This is not a link to a YouTube video.')).toBeTruthy();
    expect(screen.getByText('Type a title.')).toBeTruthy();
    expect(screen.getByText('Type a tempo from 40 to 220 BPM.')).toBeTruthy();
    fill('soundtrack-own-link', 'https://youtu.be/abcdefghijk');
    fill('soundtrack-own-title', 'My Anthem');
    fill('soundtrack-own-artist', 'Me');
    fill('soundtrack-own-bpm', '128');
    fill('soundtrack-own-energy', '4');
    fill('soundtrack-own-length', '3:45');
    fireEvent.click(screen.getByTestId('soundtrack-own-add'));
    expect(await screen.findByText('Me – My Anthem')).toBeTruthy();
    expect(screen.getByText('128 BPM · 4: strong')).toBeTruthy();
    expect(onUse).toHaveBeenCalledWith(true);
    expect(db.records.get('own-abcdefghijk')).toMatchObject({
      bpm: 128,
      energy: 4,
      durationSec: 225,
    });
    // The same video again is refused.
    fill('soundtrack-own-link', 'https://www.youtube.com/watch?v=abcdefghijk');
    fill('soundtrack-own-title', 'Again');
    fill('soundtrack-own-bpm', '90');
    fireEvent.click(screen.getByTestId('soundtrack-own-add'));
    expect(await screen.findByText('This video is already on the list.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the song My Anthem' }));
    await waitFor(() => expect(screen.queryByTestId('soundtrack-own-song')).toBeNull());
  });

  it('does not add a video the catalog has, and says where it plays from', async () => {
    const catalog = [
      {
        id: 'band-hit',
        artist: 'Band',
        title: 'Hit',
        bpm: 128,
        durationSec: 200,
        youtube: [{ id: 'catalog0001' }],
        categories: ['rock' as const],
        roles: ['steady' as const],
        energy: 3 as const,
        beat: 'steady' as const,
        clean: true,
        verified: '2026-11-01',
      },
    ];
    render(<OwnTracksPanel use={false} onUseChange={() => {}} catalog={catalog} />);
    fireEvent.click(screen.getByRole('button', { name: /My songs/ }));
    fill('soundtrack-own-link', 'https://youtu.be/catalog0001');
    fill('soundtrack-own-title', 'Hit');
    fill('soundtrack-own-bpm', '128');
    fireEvent.click(screen.getByTestId('soundtrack-own-add'));
    expect(await screen.findByText(/already in the catalog as “Band – Hit”/)).toBeTruthy();
    expect(db.records.size).toBe(0);
  });

  it('asks for the length when the link starts later, and refuses a start near the end', async () => {
    render(<OwnTracksPanel use={false} onUseChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /My songs/ }));
    fill('soundtrack-own-link', 'https://youtu.be/abcdefghijk?t=200');
    fill('soundtrack-own-title', 'Late');
    fill('soundtrack-own-bpm', '128');
    fireEvent.click(screen.getByTestId('soundtrack-own-add'));
    expect(
      await screen.findByText(/The link starts at 3:20: type the song’s length too/),
    ).toBeTruthy();
    fill('soundtrack-own-length', '3:30');
    fireEvent.click(screen.getByTestId('soundtrack-own-add'));
    expect(await screen.findByText(/less than 30 seconds before the end of the song/)).toBeTruthy();
    expect(db.records.size).toBe(0);
    fill('soundtrack-own-length', '5:00');
    fireEvent.click(screen.getByTestId('soundtrack-own-add'));
    expect(await screen.findByText('Added: Late')).toBeTruthy();
    expect(db.records.get('own-abcdefghijk')).toMatchObject({ startSec: 200, durationSec: 300 });
  });
});
