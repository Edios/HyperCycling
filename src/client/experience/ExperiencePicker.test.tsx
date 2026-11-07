import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(cards[0]).toHaveAttribute('data-experience', 'neon-grid-endurance-45');
  });

  it('filters by level', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    expect(screen.queryAllByTestId('experience-card')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByTestId('experience-card').length).toBeGreaterThan(0);
  });

  it('shows the scenario on request', () => {
    renderPicker();
    expect(screen.queryByTestId('experience-scenario')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show scenario' }));
    expect(screen.getByTestId('experience-scenario').children.length).toBe(8);
  });

  it('Start opens Setup with the workout and the experience id', () => {
    renderPicker();
    fireEvent.click(screen.getAllByTestId('experience-start')[0]!);
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/setup/class-endurance-45?exp=neon-grid-endurance-45',
    );
  });
});
