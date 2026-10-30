import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout } from '../../domain/workout';

const repo = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  put: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: {
        get: (id: string) => Promise.resolve(repo.store.get(id)),
        put: (w: { id: string }) => {
          repo.put(w);
          repo.store.set(w.id, w);
          return Promise.resolve();
        },
        remove: (id: string) => {
          repo.remove(id);
          repo.store.delete(id);
          return Promise.resolve();
        },
        list: () => Promise.resolve([...repo.store.values()]),
      },
      settings: { get: () => Promise.resolve(undefined) },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { builtinWorkouts } from '../data/builtin';
import { EditorScreen } from './EditorScreen';

function renderAt(path: string, state?: unknown) {
  const router = createMemoryRouter(
    [
      { path: '/editor/:workoutId', element: <EditorScreen /> },
      { path: '/freestyle', element: <div data-testid="freestyle-page" /> },
    ],
    { initialEntries: [state === undefined ? path : { pathname: path, state }] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const blocks = () => screen.getAllByTestId('editor-block');
const block = (i: number) => blocks()[i] as HTMLElement;
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.body, { key, ...init });

async function openNew() {
  const router = renderAt('/editor/new');
  await screen.findByTestId('editor-screen');
  return router;
}

function userWorkout(over: Partial<Workout> = {}): Workout {
  return {
    id: 'user-1',
    name: 'My ride',
    description: '',
    category: 'freestyle',
    tags: [],
    source: { kind: 'user' },
    blocks: [
      { kind: 'steady', id: 'a', durationSec: 300, intensity: { effort: 5 }, rpm: 90 },
      { kind: 'steady', id: 'b', durationSec: 120, intensity: { effort: 8 } },
    ],
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  repo.store.clear();
  repo.put.mockClear();
  repo.remove.mockClear();
});

describe('new workout', () => {
  it('starts as warm-up + steady + cool-down with a live total, and is saveable', async () => {
    await openNew();
    expect(blocks()).toHaveLength(3);
    expect(screen.getByTestId('editor-total')).toHaveTextContent('20:00');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('Save stores a user workout and moves to its own route', async () => {
    const router = await openNew();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(repo.put).toHaveBeenCalledTimes(1));
    const saved = repo.put.mock.calls[0]?.[0] as Workout;
    expect(saved.source.kind).toBe('user');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/editor/${saved.id}`));
    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('opens an imported workout as an unsaved draft', async () => {
    const imported = userWorkout({ source: { kind: 'import', file: 'x.zwo' }, name: 'Imported' });
    renderAt('/editor/new', { imported });
    await screen.findByTestId('editor-screen');
    expect(screen.getByLabelText('Workout name')).toHaveValue('Imported');
    expect(blocks()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('palette', () => {
  it('click adds a block at the end and selects it; undo removes it', async () => {
    await openNew();
    fireEvent.click(screen.getByTestId('palette-ramp'));
    expect(blocks()).toHaveLength(4);
    expect(block(3)).toHaveAttribute('data-selected', 'true');
    fireEvent.click(screen.getByTestId('palette-interval'));
    // 4 reps × 2 children join the bars
    expect(screen.getAllByTestId('editor-repeat')).toHaveLength(1);
    expect(screen.getByText('4 × repeat')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByTestId('editor-repeat')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByTestId('editor-repeat')).toBeInTheDocument();
  });

  it('keeps the total in sync', async () => {
    await openNew();
    fireEvent.click(screen.getByTestId('palette-cooldown')); // +5:00
    expect(screen.getByTestId('editor-total')).toHaveTextContent('25:00');
  });
});

describe('inspector', () => {
  async function openUser() {
    repo.store.set('user-1', userWorkout());
    renderAt('/editor/user-1');
    await screen.findByTestId('editor-screen');
    fireEvent.click(block(0));
  }

  it('shows the selected block and edits the effort with ~%FTP', async () => {
    await openUser();
    expect(screen.getByTestId('effort-caption')).toHaveTextContent('Tempo · ~78% FTP');
    fireEvent.click(within(screen.getByRole('group', { name: 'Effort' })).getByText('8'));
    expect(block(0)).toHaveAttribute('data-effort', '8');
    expect(screen.getByTestId('effort-caption')).toHaveTextContent('Threshold · ~100% FTP');
  });

  it('edits the time as m:ss on blur and rejects bad input', async () => {
    await openUser();
    const time = screen.getByLabelText('Time');
    fireEvent.change(time, { target: { value: '3:30' } });
    fireEvent.blur(time);
    expect(block(0)).toHaveAttribute('data-duration', '210');
    expect(screen.getByTestId('editor-total')).toHaveTextContent('5:30');
    fireEvent.change(time, { target: { value: '0:02' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Use m:ss, at least 0:05');
    fireEvent.blur(time);
    expect(block(0)).toHaveAttribute('data-duration', '210');
  });

  it('warns about rpm outside 55 to 120 and rejects values outside 30 to 150', async () => {
    await openUser();
    const rpm = screen.getByLabelText('Cadence');
    expect(screen.queryByTestId('field-warning')).not.toBeInTheDocument();
    fireEvent.change(rpm, { target: { value: '130' } });
    expect(screen.getByTestId('field-warning')).toHaveTextContent('Usual cadence is 55 to 120 rpm');
    fireEvent.blur(rpm);
    expect(screen.getByTestId('field-warning')).toBeInTheDocument(); // still shown for the stored value
    fireEvent.change(rpm, { target: { value: '20' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Cadence must be from 30 to 150');
  });

  it('sets position, command text and an exact %FTP', async () => {
    await openUser();
    fireEvent.click(screen.getByLabelText('Standing'));
    const cue = screen.getByLabelText('On-screen command');
    fireEvent.change(cue, { target: { value: 'Stand up!' } });
    fireEvent.blur(cue);
    const ftp = screen.getByLabelText('Exact % FTP');
    fireEvent.change(ftp, { target: { value: '88' } });
    fireEvent.blur(ftp);
    expect(screen.getByTestId('effort-caption')).toHaveTextContent('~88% FTP');
    expect(screen.getByLabelText('Standing')).toBeChecked();
    expect(screen.getByLabelText('On-screen command')).toHaveValue('Stand up!');
    fireEvent.change(ftp, { target: { value: '500' } });
    expect(screen.getByRole('alert')).toHaveTextContent('% FTP must be from 20 to 200');
  });

  it('edits the repeat count of a repeat', async () => {
    await openNew();
    fireEvent.click(screen.getByTestId('palette-interval'));
    const times = screen.getByLabelText('Repeats');
    fireEvent.change(times, { target: { value: '6' } });
    fireEvent.blur(times);
    expect(screen.getByText('6 × repeat')).toBeInTheDocument();
  });

  it('shows the music hint read-only', async () => {
    repo.store.set('user-1', userWorkout({ musicHints: { a: 'Something upbeat, 120 bpm' } }));
    renderAt('/editor/user-1');
    await screen.findByTestId('editor-screen');
    fireEvent.click(block(0));
    expect(screen.getByTestId('music-hint')).toHaveTextContent('Something upbeat, 120 bpm');
  });
});

describe('music track', () => {
  it('pins a Spotify track with a start time and shows a pill; rejects bad links', async () => {
    repo.store.set('user-1', userWorkout());
    renderAt('/editor/user-1');
    await screen.findByTestId('editor-screen');
    fireEvent.click(block(1));
    const url = screen.getByTestId('track-url');
    fireEvent.change(url, { target: { value: 'https://example.com/nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Not a Spotify track or YouTube link');
    expect(screen.queryByTestId('music-pill')).not.toBeInTheDocument();

    fireEvent.change(url, {
      target: { value: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=1' },
    });
    fireEvent.change(screen.getByTestId('track-start'), { target: { value: '0:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin track' }));
    expect(screen.getByTestId('music-pill')).toHaveTextContent('Spotify · from 0:45');
    expect(screen.getByTestId('track-pinned')).toHaveTextContent('Spotify · from 0:45');

    fireEvent.click(screen.getByRole('button', { name: 'Remove track' }));
    expect(screen.queryByTestId('music-pill')).not.toBeInTheDocument();
  });

  it('clicking the pin placeholder focuses the track field', async () => {
    repo.store.set('user-1', userWorkout());
    renderAt('/editor/user-1');
    await screen.findByTestId('editor-screen');
    fireEvent.click(block(0));
    fireEvent.click(screen.getByTestId('music-pin'));
    await waitFor(() => expect(screen.getByTestId('track-url')).toHaveFocus());
  });
});

describe('keyboard', () => {
  async function openSelected() {
    await openNew();
    fireEvent.click(block(1)); // the 10 min steady block
  }

  it('arrows move the selection', async () => {
    await openSelected();
    press('ArrowRight');
    expect(block(2)).toHaveAttribute('data-selected', 'true');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(block(0)).toHaveAttribute('data-selected', 'true');
  });

  it('+/- change the duration by 15 s, Shift by 5 s', async () => {
    await openSelected();
    press('+');
    expect(block(1)).toHaveAttribute('data-duration', '615');
    press('-', { shiftKey: true });
    expect(block(1)).toHaveAttribute('data-duration', '610');
    press('-');
    expect(block(1)).toHaveAttribute('data-duration', '595');
  });

  it('up/down change the effort', async () => {
    await openSelected();
    press('ArrowUp');
    expect(block(1)).toHaveAttribute('data-effort', '6');
    press('ArrowDown');
    press('ArrowDown');
    expect(block(1)).toHaveAttribute('data-effort', '4');
  });

  it('Ctrl+D duplicates, Delete removes, Ctrl+Z / Ctrl+Y undo and redo', async () => {
    await openSelected();
    press('d', { ctrlKey: true });
    expect(blocks()).toHaveLength(4);
    press('Delete');
    expect(blocks()).toHaveLength(3);
    press('z', { ctrlKey: true });
    expect(blocks()).toHaveLength(4);
    press('y', { ctrlKey: true });
    expect(blocks()).toHaveLength(3);
  });

  it('is ignored while typing in a field', async () => {
    await openSelected();
    const name = screen.getByLabelText('Workout name');
    fireEvent.keyDown(name, { key: 'Delete' });
    expect(blocks()).toHaveLength(3);
  });

  it('shows an error when an action is rejected', async () => {
    await openNew();
    fireEvent.click(screen.getByTestId('palette-interval'));
    const repeat = screen.getByTestId('editor-repeat');
    fireEvent.click(repeat);
    const times = screen.getByLabelText('Repeats');
    fireEvent.change(times, { target: { value: '60' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Repeats must be from 2 to 50');
  });
});

describe('dirty state and leaving', () => {
  it('Save is disabled until something changes, then enabled; saving clears it', async () => {
    repo.store.set('user-1', userWorkout());
    renderAt('/editor/user-1');
    await screen.findByTestId('editor-screen');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.click(block(0));
    press('+');
    expect(save).toBeEnabled();
    await act(async () => {
      fireEvent.click(save);
    });
    await waitFor(() => expect(repo.put).toHaveBeenCalled());
    await waitFor(() => expect(save).toBeDisabled());
    expect((repo.put.mock.calls[0]?.[0] as Workout).blocks[0]).toMatchObject({ durationSec: 315 });
  });

  it('Save is disabled for an invalid (empty) workout', async () => {
    await openNew();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(block(0));
      press('Delete');
    }
    expect(screen.queryAllByTestId('editor-block')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('asks before leaving with unsaved changes; Stay keeps, Leave goes', async () => {
    const router = await openNew();
    fireEvent.click(screen.getByRole('link', { name: '‹ Freestyle' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('You have unsaved changes');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/editor/new');
    fireEvent.click(screen.getByRole('link', { name: '‹ Freestyle' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/freestyle'));
  });

  it('leaves without asking when nothing changed', async () => {
    repo.store.set('user-1', userWorkout());
    const router = renderAt('/editor/user-1');
    await screen.findByTestId('editor-screen');
    fireEvent.click(screen.getByRole('link', { name: '‹ Freestyle' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/freestyle'));
  });

  it('registers a beforeunload guard only while dirty', async () => {
    repo.store.set('user-1', userWorkout());
    renderAt('/editor/user-1');
    await screen.findByTestId('editor-screen');
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.click(block(0));
    press('+');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe('read-only built-ins', () => {
  async function openBuiltin() {
    const w = builtinWorkouts[0] as Workout;
    renderAt(`/editor/${encodeURIComponent(w.id)}`);
    await screen.findByTestId('editor-screen');
    return w;
  }

  it('disables editing and offers Duplicate to edit', async () => {
    await openBuiltin();
    expect(screen.getByTestId('editor-screen')).toHaveAttribute('data-readonly', 'true');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate to edit' })).toBeEnabled();
    expect(screen.getByTestId('palette-steady')).toBeDisabled();
    expect(screen.getByLabelText('Workout name')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('allows selecting but not deleting or resizing with the keyboard', async () => {
    await openBuiltin();
    const before = blocks().length;
    fireEvent.click(block(0));
    expect(block(0)).toHaveAttribute('data-selected', 'true');
    const duration = block(0).getAttribute('data-duration');
    press('Delete');
    press('+');
    expect(blocks()).toHaveLength(before);
    expect(block(0)).toHaveAttribute('data-duration', duration);
    expect(screen.getByLabelText('Time')).toBeDisabled();
  });

  it('Duplicate to edit saves a user copy and opens it', async () => {
    const w = await openBuiltin();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate to edit' }));
    await waitFor(() => expect(repo.put).toHaveBeenCalledTimes(1));
    const copy = repo.put.mock.calls[0]?.[0] as Workout;
    expect(copy.id).not.toBe(w.id);
    expect(copy.source.kind).toBe('user');
    expect(copy.name).toMatch(/\(copy\)$/);
    await waitFor(() =>
      expect(screen.getByTestId('editor-screen')).toHaveAttribute('data-readonly', 'false'),
    );
  });
});

describe('user workout actions', () => {
  it('Duplicate keeps the original and opens the copy', async () => {
    repo.store.set('user-1', userWorkout());
    const router = renderAt('/editor/user-1');
    await screen.findByTestId('editor-screen');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(repo.put).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.state.location.pathname).not.toBe('/editor/user-1'));
    expect(repo.store.has('user-1')).toBe(true);
  });

  it('Delete asks for confirmation, then removes and returns to Freestyle', async () => {
    repo.store.set('user-1', userWorkout());
    const router = renderAt('/editor/user-1');
    await screen.findByTestId('editor-screen');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete “My ride”?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(repo.remove).toHaveBeenCalledWith('user-1'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/freestyle'));
  });

  it('shows a message for an unknown workout', async () => {
    renderAt('/editor/nope');
    expect(await screen.findByTestId('editor-missing')).toHaveTextContent('not found');
  });
});

describe('header', () => {
  it('renames and changes the category', async () => {
    repo.store.set('user-1', userWorkout());
    renderAt('/editor/user-1');
    await screen.findByTestId('editor-screen');
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByLabelText('Progres'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(repo.put).toHaveBeenCalled());
    expect(repo.put.mock.calls[0]?.[0]).toMatchObject({ name: 'Renamed', category: 'progres' });
  });
});
