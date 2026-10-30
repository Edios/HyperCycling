import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Workout } from '../../domain/workout';

const mine = vi.hoisted(() => ({ list: [] as Workout[] }));

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: { list: () => Promise.resolve(mine.list) },
      settings: { get: () => Promise.resolve(undefined) },
    }),
}));

vi.setConfig({ testTimeout: 20_000 });

import { builtinWorkouts } from '../data/builtin';
import { FreestyleTab } from './FreestyleTab';

function renderTab() {
  return render(
    <MemoryRouter>
      <FreestyleTab />
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

  it('import and new workout are disabled stubs', async () => {
    renderTab();
    const imp = await screen.findByRole('button', { name: 'Import file' });
    const add = screen.getByRole('button', { name: /New workout/ });
    for (const b of [imp, add]) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', 'Coming soon');
    }
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
