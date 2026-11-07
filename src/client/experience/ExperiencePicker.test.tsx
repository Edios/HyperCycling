import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { builtinWorkouts } from '../data/builtin';
import { ExperiencePicker } from './ExperiencePicker';

vi.mock('../data/useLibrary', () => ({
  useLibrary: () => ({ workouts: builtinWorkouts, loaded: true }),
}));

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderPicker() {
  return render(
    <MemoryRouter initialEntries={['/experiences']}>
      <Routes>
        <Route path="/experiences" element={<ExperiencePicker />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ExperiencePicker', () => {
  it('lists the built-in Experience as a card', () => {
    renderPicker();
    const cards = screen.getAllByTestId('experience-card');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.map((c) => c.getAttribute('data-experience')).sort()).toEqual([
      'neon-grid-30',
      'neon-grid-45',
      'neon-grid-45-light',
    ]);
  });

  it('filters by level', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Easy' }));
    expect(screen.queryAllByTestId('experience-card')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    expect(screen.getAllByTestId('experience-card')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    expect(screen.getAllByTestId('experience-card')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByTestId('experience-card').length).toBeGreaterThan(0);
  });

  it('shows the scenario on request', () => {
    renderPicker();
    expect(screen.queryByTestId('experience-scenario')).toBeNull();
    const card = screen
      .getAllByTestId('experience-card')
      .find((c) => c.getAttribute('data-experience') === 'neon-grid-45')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Show scenario' }));
    const rows = screen.getByTestId('experience-scenario').children;
    expect(rows.length).toBe(11);
    // m:ss, so the rows add up to the 45 minutes of the class
    expect(rows[0]).toHaveTextContent('Song 1: 5:00');
    expect(rows[3]).toHaveTextContent('Song 4: 2:30');
    let sec = 0;
    for (const r of Array.from(rows)) {
      const [m, s] = (/(\d+):(\d\d)$/.exec(r.textContent ?? '') ?? []).slice(1).map(Number);
      sec += (m ?? 0) * 60 + (s ?? 0);
    }
    expect(sec).toBe(45 * 60);
  });

  it('Start opens Setup with the workout and the experience id', () => {
    renderPicker();
    const card = screen
      .getAllByTestId('experience-card')
      .find((c) => c.getAttribute('data-experience') === 'neon-grid-45')!;
    fireEvent.click(within(card).getByTestId('experience-start'));
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/setup/class-neon-grid-45?exp=neon-grid-45',
    );
  });
});
