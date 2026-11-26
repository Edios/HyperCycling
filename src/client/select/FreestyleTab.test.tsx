import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Workout } from '../../domain/workout';

const mine = vi.hoisted(() => ({ list: [] as Workout[] }));
const put = vi.hoisted(() => vi.fn());
const logs = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: {
        list: () => Promise.resolve(mine.list),
        put: (w: Workout) => {
          put(w);
          return Promise.resolve();
        },
      },
      settings: { get: () => Promise.resolve(undefined) },
      sessionLogs: { list: () => Promise.resolve(logs.list) },
    }),
}));

vi.setConfig({ testTimeout: 60_000 });

import { builtinWorkouts } from '../data/builtin';
import { FreestyleTab } from './FreestyleTab';
import { GROUP_LIMIT, groupLibrary } from './model';

function Where() {
  return <div data-testid="at">{useLocation().pathname}</div>;
}

function renderTab() {
  return render(
    <MemoryRouter>
      <FreestyleTab />
      <Where />
    </MemoryRouter>,
  );
}

const cards = () => screen.getAllByTestId('workout-card');

describe('FreestyleTab', () => {
  it('nudges toward an easier day after a recent hard ride (R4b)', async () => {
    const hard = builtinWorkouts.find((w) => w.tags.includes('vo2')) as Workout;
    logs.list = [
      {
        workoutId: hard.id,
        endedAt: new Date(Date.now() - 3_600_000).toISOString(),
        completed: true,
        riddenSec: 1800,
      },
    ];
    renderTab();
    const hint = await screen.findByTestId('rotation-hint');
    expect(hint).toHaveTextContent(/Last ride: .*easier/);
    fireEvent.click(within(hint).getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('button', { name: 'Zone 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('rotation-hint')).toBeNull();
    logs.list = [];
  });

  it('shows no hint without a recent ride', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    expect(screen.queryByTestId('rotation-hint')).toBeNull();
  });

  it('shows the library in groups of a few rows, each with Show more (audit N-09)', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    const groups = groupLibrary(builtinWorkouts);
    expect(groups.map((g) => g.id)).toEqual(['recommended', 'short', 'hiit', 'rest']);
    const onScreen = groups.reduce((n, g) => n + Math.min(GROUP_LIMIT, g.workouts.length), 0);
    expect(cards()).toHaveLength(onScreen);
    const rest = screen.getByTestId('group-rest');
    expect(within(rest).getByRole('heading', { level: 2 })).toHaveTextContent('More workouts');
    const restSize = groups.find((g) => g.id === 'rest')?.workouts.length ?? 0;
    fireEvent.click(
      within(rest).getByRole('button', { name: `Show ${restSize - GROUP_LIMIT} more` }),
    );
    expect(within(rest).getAllByTestId('workout-card')).toHaveLength(restSize);
    fireEvent.click(within(rest).getByRole('button', { name: 'Show less' }));
    expect(within(rest).getAllByTestId('workout-card')).toHaveLength(GROUP_LIMIT);
  });

  it('HIIT and Short link to their chip with the whole count (the classes sit in Recommended)', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    const hiitTotal = builtinWorkouts.filter((w) => w.tags.includes('hiit')).length;
    const all = screen.getByTestId('group-all-hiit');
    expect(all).toHaveTextContent(`All ${hiitTotal}`);
    fireEvent.click(all);
    expect(screen.getByRole('button', { name: 'HIIT' })).toHaveAttribute('aria-pressed', 'true');
    expect(cards()).toHaveLength(hiitTotal);
  });

  it('a row is the name, the profile and the time, without difficulty ticks', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    const row = cards()[0] as HTMLElement;
    expect(within(row).queryByRole('img', { name: /^Difficulty/ })).toBeNull();
    expect(row).toHaveTextContent(/\d+ min$/);
  });

  it('filters by chip and restores on All', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    const hiitCount = builtinWorkouts.filter((w) => w.tags.includes('hiit')).length;
    expect(hiitCount).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'HIIT' }));
    expect(cards()).toHaveLength(hiitCount);
    expect(screen.getByRole('button', { name: 'HIIT' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByTestId('group-recommended')).toBeInTheDocument();
  });

  it('searches by name', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'tabata' } });
    const names = cards().map((c) => c.textContent?.toLowerCase() ?? '');
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.includes('tabata'))).toBe(true);
  });

  it('shows an empty message when nothing matches', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzzqqq' } });
    expect(screen.queryAllByTestId('workout-card')).toHaveLength(0);
    expect(screen.getByText('Nothing matches “zzzzqqq”')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByTestId('group-recommended')).toBeInTheDocument();
  });

  it('the first row is selected and the preview Ride button links to setup', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    expect(cards()[0]).toHaveAttribute('aria-selected', 'true');
    const ride = screen.getByTestId('workout-ride');
    expect(ride.getAttribute('href')).toMatch(/^\/setup\/.+/);
    expect(ride).toHaveTextContent('Ride');
  });

  it('clicking a row moves the preview; arrows move the selection and Enter rides', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    const list = within(screen.getByTestId('group-recommended')).getByRole('listbox');
    fireEvent.click(cards()[2] as HTMLElement);
    expect(cards()[2]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(cards()[1]).toHaveAttribute('aria-selected', 'true');
    expect(list.getAttribute('aria-activedescendant')).toBe(cards()[1]?.id);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(cards()[3]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent(/^\/setup\//));
  });

  it('the arrows walk from one group into the next', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    const first = within(screen.getByTestId('group-recommended')).getByRole('listbox');
    fireEvent.keyDown(first, { key: 'End' });
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    const last = cards()[GROUP_LIMIT - 1] as HTMLElement;
    fireEvent.click(last);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const next = within(screen.getByTestId('group-short')).getAllByTestId('workout-card')[0];
    expect(next).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(
      within(screen.getByTestId('group-short')).getByRole('listbox'),
    );
  });

  it('New workout opens the editor draft', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Create workout/ }));
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/editor/new'));
  });

  it('Import file opens the import dialog, shows warnings and opens the editor with the result', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Import file' }));
    const dialog = await screen.findByRole('dialog');
    const text = readFileSync(
      join(process.cwd(), 'src/domain/parsers/__fixtures__/messy.zwo'),
      'utf8',
    );
    const file = new File([text], 'messy.zwo', { type: 'application/xml' });
    fireEvent.change(within(dialog).getByTestId('import-input'), { target: { files: [file] } });
    expect(await within(dialog).findByTestId('import-warnings')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/editor/new'));
  });

  it('import dialog rejects unsupported files and accepts a drop', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Import file' }));
    const dialog = await screen.findByRole('dialog');
    const bad = new File(['x'], 'notes.txt');
    fireEvent.drop(within(dialog).getByTestId('import-drop'), {
      dataTransfer: { files: [bad] },
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only .zwo, .erg and .mrc');
    const text = readFileSync(
      join(process.cwd(), 'src/domain/parsers/__fixtures__/normal.zwo'),
      'utf8',
    );
    fireEvent.drop(within(dialog).getByTestId('import-drop'), {
      dataTransfer: { files: [new File([text], 'normal.zwo')] },
    });
    expect(await within(dialog).findByTestId('import-result')).toBeInTheDocument();
  });

  it('an ERG in watts without FTP asks for an FTP and retries with it', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Import file' }));
    const dialog = await screen.findByRole('dialog');
    const text = readFileSync(
      join(process.cwd(), 'src/domain/parsers/__fixtures__/watts-no-ftp.erg'),
      'utf8',
    );
    fireEvent.change(within(dialog).getByTestId('import-input'), {
      target: { files: [new File([text], 'w.erg')] },
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This file is in watts and has no FTP',
    );
    fireEvent.change(within(dialog).getByTestId('import-ftp'), { target: { value: '250' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(await within(dialog).findByTestId('import-result')).toBeInTheDocument();
  });

  it('translates parser warnings into generic messages', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Import file' }));
    const dialog = await screen.findByRole('dialog');
    const text = readFileSync(
      join(process.cwd(), 'src/domain/parsers/__fixtures__/messy.zwo'),
      'utf8',
    );
    fireEvent.change(within(dialog).getByTestId('import-input'), {
      target: { files: [new File([text], 'messy.zwo')] },
    });
    const list = await within(dialog).findByTestId('import-warnings');
    expect(list).toHaveTextContent('Skipped an unsupported element <Mystery>.');
    expect(list).not.toHaveTextContent('zero-length block dropped');
  });

  it('the preview has a Duplicate and edit button that saves a copy and opens it', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    const first = builtinWorkouts[0] as Workout;
    const buttons = screen.getAllByRole('button', { name: /^Duplicate and edit:/ });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const copy = put.mock.calls[0]?.[0] as Workout;
    expect(copy.id).not.toBe(first.id);
    expect(copy.source.kind).toBe('user');
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent(`/editor/${copy.id}`), {
      timeout: 8000,
    });
  });

  it('includes user workouts under the Mine filter', async () => {
    const { localized: _drop, ...base } = builtinWorkouts[0] as Workout;
    void _drop;
    mine.list = [{ ...base, id: 'user-1', name: 'My Tuesday', source: { kind: 'user' } }];
    renderTab();
    await screen.findByText('My Tuesday');
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent('My Tuesday');
    expect(within(cards()[0] as HTMLElement).getByTestId('mine-badge')).toHaveTextContent('Mine');
    mine.list = [];
  });
});

describe('FreestyleTab edit button (H3)', () => {
  it('a selected own workout gets Edit, built-ins only Duplicate', async () => {
    const own = {
      ...(builtinWorkouts[0] as Workout),
      id: 'mine-1',
      name: 'Mine',
      source: { kind: 'user' as const },
    };
    mine.list = [own];
    try {
      renderTab();
      await screen.findByText('Mine');
      expect(screen.queryByRole('link', { name: /^Edit: / })).toBeNull();
      fireEvent.click(
        cards().find(
          (c) => c.textContent?.includes('Mine') && c.querySelector('[data-testid=mine-badge]'),
        ) as HTMLElement,
      );
      const edit = await screen.findAllByRole('link', { name: /^Edit: / });
      expect(edit).toHaveLength(1);
      expect(edit[0]).toHaveAttribute('href', '/editor/mine-1');
      expect(screen.getAllByRole('button', { name: /^Duplicate and edit: / })).toHaveLength(1);
    } finally {
      mine.list = [];
    }
  });
});

describe('FreestyleTab on a phone', () => {
  it('opens the preview as a sheet on tap and closes it with Escape', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      renderTab();
      await screen.findAllByTestId('workout-card');
      expect(screen.queryByTestId('preview-sheet')).toBeNull();
      fireEvent.click(cards()[1] as HTMLElement);
      expect(screen.getByTestId('preview-sheet')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByTestId('preview-sheet')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});
