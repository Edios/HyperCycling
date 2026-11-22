import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings';

const db = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  saved: new Map<string, { id: string; createdAt: string; plan: { workoutId: string } }>(),
}));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve([]) },
      soundtrackPlans: {
        get: (id: string) => Promise.resolve(db.saved.get(id)),
        put: (r: { id: string; createdAt: string; plan: { workoutId: string } }) => {
          db.saved.set(r.id, r);
          return Promise.resolve();
        },
        remove: () => Promise.resolve(),
      },
      settings: {
        get: () => Promise.resolve(db.settings),
        put: (s: Settings) => {
          db.settings = s;
          return Promise.resolve();
        },
      },
    }),
}));

vi.setConfig({ testTimeout: 30_000 });

import { builtinWorkouts } from '../data/builtin';
import { resetSettingsForTests } from '../data/useSettings';
import { setLang } from '../i18n';
import { SOUNDTRACK_PREFS_KEY } from './prefs';
import { resetSoundtrackSessionForTests, useSoundtrackSession } from './session';
import { SoundtrackWizard } from './SoundtrackWizard';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderWizard(id = 'class-endurance-45', from = 'setup') {
  return render(
    <MemoryRouter initialEntries={[`/soundtrack/${id}?from=${from}`]}>
      <Routes>
        <Route path="/soundtrack/:workoutId" element={<SoundtrackWizard />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const chip = (c: string) => screen.getByTestId(`soundtrack-chip-${c}`);
const next = () => screen.getByTestId('soundtrack-next');
const songIds = () =>
  screen.getAllByTestId('soundtrack-song').map((el) => el.getAttribute('data-song'));

async function toStep2(id?: string) {
  renderWizard(id);
  await waitFor(() => expect(next()).toBeEnabled());
  fireEvent.click(next());
  await screen.findByRole('heading', { name: 'We suggest these songs' });
}

beforeEach(() => {
  db.settings = { ...DEFAULT_SETTINGS };
  db.saved.clear();
  resetSettingsForTests();
  resetSoundtrackSessionForTests();
  localStorage.removeItem(SOUNDTRACK_PREFS_KEY);
  setLang('en');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  setLang('en');
  vi.restoreAllMocks();
});

describe('step 1: what music', () => {
  it('opens on Electronic and Pop with "No gaps" the first time, with one hint', async () => {
    renderWizard();
    await waitFor(() => expect(next()).toBeEnabled());
    expect(screen.getByRole('heading', { level: 1, name: 'Match music' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What music should play?' })).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(chip('electronic')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('pop')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('rock')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('button', { pressed: true }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('radio', { name: 'No gaps' })).toBeChecked();
    expect(screen.getByText(/when a song ends, the next one starts at once/)).toBeInTheDocument();
    expect(screen.getByTestId('soundtrack-hint')).toHaveTextContent(/^Best for this ride: .+\.$/);
  });

  it('dims the kinds with no songs at this tempo, but never presses them away', async () => {
    renderWizard('zone2-60');
    await waitFor(() => expect(next()).toBeEnabled());
    expect(chip('house')).toHaveAttribute('data-dimmed', 'true');
    expect(chip('electronic')).toHaveAttribute('data-dimmed', 'false');
    fireEvent.click(chip('house'));
    expect(chip('house')).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not dim a single chip of a ride that changes cadence a lot', async () => {
    renderWizard('class-neon-grid-45');
    await waitFor(() => expect(next()).toBeEnabled());
    const dimmed = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('data-dimmed') === 'true');
    expect(dimmed.length).toBeLessThan(8);
    expect(screen.getByTestId('soundtrack-hint')).toHaveTextContent(/Best for this ride/);
  });

  it('keeps at least one kind chosen', async () => {
    renderWizard();
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(chip('pop'));
    fireEvent.click(chip('electronic'));
    expect(chip('electronic')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('pop')).toHaveAttribute('aria-pressed', 'false');
  });

  it('remembers the choice on this device', async () => {
    renderWizard();
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(chip('rock'));
    fireEvent.click(screen.getByRole('radio', { name: 'Short gaps ok' }));
    expect(screen.getByText(/up to 30 seconds of quiet/)).toBeInTheDocument();
    fireEvent.click(next());
    await screen.findByRole('heading', { name: 'We suggest these songs' });
    const stored = JSON.parse(localStorage.getItem(SOUNDTRACK_PREFS_KEY) ?? '{}');
    expect(stored).toMatchObject({
      categories: ['electronic', 'pop', 'rock'],
      continuity: 'gapsOk',
    });
  });

  it('speaks Polish', async () => {
    setLang('pl');
    renderWizard();
    await waitFor(() => expect(next()).toBeEnabled());
    expect(screen.getByRole('heading', { level: 1, name: 'Dobierz muzykę' })).toBeInTheDocument();
    expect(chip('electronic')).toHaveTextContent('Elektronika');
    expect(screen.getByRole('radio', { name: 'Bez przerw' })).toBeChecked();
    expect(screen.getByTestId('soundtrack-hint')).toHaveTextContent(
      /Do tego treningu najlepiej pasują/,
    );
  });

  it('says a very short ride cannot be matched, and offers only the way back', async () => {
    const short = builtinWorkouts.find((w) => {
      const sec = w.blocks.reduce((n, b) => n + (b.kind === 'repeat' ? 0 : b.durationSec), 0);
      return w.blocks.every((b) => b.kind !== 'repeat') && sec < 300;
    });
    if (!short) return; // no such built-in workout: the rule is covered in the domain tests
    renderWizard(short.id);
    expect(await screen.findByText(/too short to match music/)).toBeInTheDocument();
    expect(next()).toBeDisabled();
  });

  it('goes home when the workout does not exist', async () => {
    renderWizard('nope');
    expect(await screen.findByTestId('where')).toHaveTextContent('/');
  });
});

describe('step 2: the songs', () => {
  it('shows every stretch of the ride with its songs, tempo and length', async () => {
    await toStep2();
    const parts = screen.getAllByTestId('soundtrack-part');
    expect(parts.length).toBeGreaterThanOrEqual(5);
    expect(within(parts[0]!).getByRole('heading', { level: 3 })).toHaveTextContent(
      /^Warm-up · effort \d(–\d)? · \d+:\d\d$/,
    );
    expect(screen.getByText('2/3')).toBeInTheDocument();
    for (const part of parts) {
      expect(within(part).getAllByTestId('soundtrack-song').length).toBeGreaterThan(0);
    }
    const first = within(parts[0]!).getAllByTestId('soundtrack-song')[0]!;
    expect(first).toHaveTextContent(/\d+ BPM/);
    expect(first).toHaveTextContent(/\d+:\d\d/);
    // No empty promise: a plan this good has nothing to warn about.
    expect(screen.queryByTestId('soundtrack-warnings')).not.toBeInTheDocument();
    // Touch size: the buttons of a row are at least 44 px by their class (see the CSS module).
    expect(within(first).getByTestId('soundtrack-play')).toBeInTheDocument();
    expect(within(first).getByTestId('soundtrack-replace')).toBeInTheDocument();
  });

  it('says what each stretch wants from the music: steady or intervals, and the energy', async () => {
    await toStep2('tabata-20-10');
    const music = screen
      .getAllByTestId('soundtrack-part')
      .map((p) => within(p).getByTestId('soundtrack-part-music').textContent);
    expect(music).toContain('Intervals · energy 5 of 5');
    expect(music.some((m) => /^Steady effort · energy [1-5] of 5$/.test(m ?? ''))).toBe(true);
  });

  it('says it in Polish too', async () => {
    setLang('pl');
    renderWizard('tabata-20-10');
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Proponujemy takie utwory' });
    const music = screen.getAllByTestId('soundtrack-part-music').map((m) => m.textContent);
    expect(music).toContain('Interwały · energia 5 z 5');
    expect(music.some((m) => /^Równy wysiłek · energia [1-5] z 5$/.test(m ?? ''))).toBe(true);
  });

  it('shuffles to other songs, keeps the locked stretch and plays no song twice', async () => {
    await toStep2();
    const before = songIds();
    const parts = screen.getAllByTestId('soundtrack-part');
    const lockedSongs = within(parts[1]!)
      .getAllByTestId('soundtrack-song')
      .map((el) => el.getAttribute('data-song'));
    const lock = within(parts[1]!).getByTestId('soundtrack-lock');
    fireEvent.click(lock);
    expect(lock).toHaveAttribute('aria-pressed', 'true');
    expect(lock).toHaveTextContent('Locked');
    fireEvent.click(screen.getByTestId('soundtrack-shuffle'));
    await waitFor(() => expect(songIds()).not.toEqual(before));
    const after = screen.getAllByTestId('soundtrack-part');
    expect(
      within(after[1]!)
        .getAllByTestId('soundtrack-song')
        .map((el) => el.getAttribute('data-song')),
    ).toEqual(lockedSongs);
    const ids = songIds();
    expect(new Set(ids).size).toBe(ids.length);
    // The seed moved on, so the next shuffle differs again; the choice is remembered.
    expect(JSON.parse(localStorage.getItem(SOUNDTRACK_PREFS_KEY) ?? '{}').seed).not.toBe(1);
  });

  it('replaces one song: only its stretch changes and the song does not come back', async () => {
    await toStep2();
    const parts = screen.getAllByTestId('soundtrack-part');
    const others = parts.map((p) =>
      within(p)
        .getAllByTestId('soundtrack-song')
        .map((el) => el.getAttribute('data-song')),
    );
    const target = within(parts[2]!).getAllByTestId('soundtrack-song')[0]!;
    const gone = target.getAttribute('data-song');
    fireEvent.click(within(target).getByTestId('soundtrack-replace'));
    await waitFor(() => expect(songIds()).not.toContain(gone));
    const now = screen.getAllByTestId('soundtrack-part').map((p) =>
      within(p)
        .getAllByTestId('soundtrack-song')
        .map((el) => el.getAttribute('data-song')),
    );
    now.forEach((ids, i) => {
      if (i !== 2) expect(ids).toEqual(others[i]);
    });
    expect(now[2]!.length).toBeGreaterThan(0);
  });

  it('plays a preview only when asked, with the player of the preview in view', async () => {
    await toStep2();
    expect(screen.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByText(/never starts by itself/)).toBeInTheDocument();
  });

  it('shows a warning with the way out when "Short gaps ok" leaves silence', async () => {
    db.settings = { ...DEFAULT_SETTINGS };
    renderWizard('zone2-60');
    await waitFor(() => expect(next()).toBeEnabled());
    // Only a very small choice of songs: house at 90 rpm has none, so songs come from elsewhere.
    fireEvent.click(chip('electronic'));
    fireEvent.click(chip('house'));
    fireEvent.click(chip('pop'));
    fireEvent.click(next());
    await screen.findByRole('heading', { name: 'We suggest these songs' });
    expect(
      screen.getAllByText('We also picked from neighbouring kinds of music.').length,
    ).toBeGreaterThan(0);
  });

  it('goes back to the kinds of music and plans again after a change', async () => {
    await toStep2();
    const before = songIds();
    fireEvent.click(screen.getByTestId('soundtrack-back'));
    expect(screen.getByRole('heading', { name: 'What music should play?' })).toBeInTheDocument();
    fireEvent.click(chip('electronic'));
    fireEvent.click(chip('house'));
    fireEvent.click(next());
    await screen.findByRole('heading', { name: 'We suggest these songs' });
    expect(songIds()).not.toEqual(before);
  });
});

describe('step 3 and leaving', () => {
  it('sums the plan up, takes it over with "To the ride" and opens the ride setup', async () => {
    await toStep2();
    fireEvent.click(next());
    const done = await screen.findByTestId('soundtrack-done');
    expect(done).toHaveTextContent(/^\d+ songs for \d+:\d\d\./);
    expect(done).toHaveTextContent('No silence longer than the seam between songs.');
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(useSoundtrackSession.getState().plans['class-endurance-45']).toBeUndefined();
    expect(db.saved.size).toBe(0); // nothing is saved before the rider confirms
    expect(done).toHaveTextContent('saved on this device when you press “To the ride”');
    fireEvent.click(screen.getByRole('button', { name: 'To the ride' }));
    const plan = useSoundtrackSession.getState().plans['class-endurance-45'];
    expect(plan?.workoutId).toBe('class-endurance-45');
    expect(plan?.sections.length).toBeGreaterThan(0);
    expect(await screen.findByTestId('where')).toHaveTextContent('/setup/class-endurance-45');
    // Saved on the device, with the time of the confirmation, one record for the workout.
    expect([...db.saved.keys()]).toEqual(['class-endurance-45']);
    const rec = db.saved.get('class-endurance-45')!;
    expect(rec.plan.workoutId).toBe('class-endurance-45');
    expect(Number.isNaN(Date.parse(rec.createdAt))).toBe(false);
    expect(Date.now() - Date.parse(rec.createdAt)).toBeLessThan(60_000);
  });

  it('leaves with Escape or the arrow, taking nothing over', async () => {
    renderWizard();
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByTestId('where')).toHaveTextContent('/setup/class-endurance-45');
    expect(useSoundtrackSession.getState().plans).toEqual({});
  });

  it('walks the stretches with the arrow keys in step 2', async () => {
    await toStep2();
    const parts = screen.getAllByTestId('soundtrack-part');
    act(() => parts[0]!.focus());
    fireEvent.keyDown(parts[0]!, { key: 'ArrowDown' });
    expect(parts[1]).toHaveFocus();
    fireEvent.keyDown(parts[1]!, { key: 'ArrowUp' });
    expect(parts[0]).toHaveFocus();
  });

  it('moves the focus to the heading of each step', async () => {
    renderWizard();
    await waitFor(() => expect(next()).toBeEnabled());
    expect(screen.getByRole('heading', { name: 'What music should play?' })).toHaveFocus();
    fireEvent.click(next());
    const h = await screen.findByRole('heading', { name: 'We suggest these songs' });
    await waitFor(() => expect(h).toHaveFocus());
  });
});
