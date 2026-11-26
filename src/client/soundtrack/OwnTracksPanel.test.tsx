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
});
