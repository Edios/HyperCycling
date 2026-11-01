import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Workout } from '../../domain/workout';

const mine = vi.hoisted(() => ({ list: [] as Workout[] }));
const put = vi.hoisted(() => vi.fn());

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
    }),
}));

vi.setConfig({ testTimeout: 60_000 });

import { builtinWorkouts } from '../data/builtin';
import { FreestyleTab } from './FreestyleTab';

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
  it('shows every built-in workout by default', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    expect(cards()).toHaveLength(builtinWorkouts.length);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
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
    expect(cards()).toHaveLength(builtinWorkouts.length);
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
    expect(screen.getByText('No workouts match.')).toBeInTheDocument();
  });

  it('cards link to setup', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    const first = cards()[0] as HTMLElement;
    expect(first.getAttribute('href')).toMatch(/^\/setup\/.+/);
  });

  it('New workout opens the editor draft', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /New workout/ }));
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

  it('every card has a Duplicate button that saves a copy and opens it', async () => {
    renderTab();
    await screen.findAllByTestId('workout-card');
    const first = builtinWorkouts[0] as Workout;
    const buttons = screen.getAllByRole('button', { name: /^Duplicate:/ });
    expect(buttons).toHaveLength(builtinWorkouts.length);
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
    mine.list = [];
  });
});

describe('FreestyleTab edit button (H3)', () => {
  it('own workouts get Edit, built-ins keep Duplicate only', async () => {
    const own = { ...(builtinWorkouts[0] as Workout), id: 'mine-1', name: 'Mine', source: { kind: 'user' as const } };
    mine.list = [own];
    try {
      renderTab();
      await screen.findAllByTestId('workout-card');
      const edit = await screen.findAllByRole('link', { name: /^Edit: / });
      expect(edit).toHaveLength(1);
      expect(edit[0]).toHaveAttribute('href', '/editor/mine-1');
      expect(screen.getAllByRole('button', { name: /^Duplicate: / })).toHaveLength(
        builtinWorkouts.length + 1,
      );
    } finally {
      mine.list = [];
    }
  });
});
