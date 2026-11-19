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

const card = (): HTMLElement => screen.getByTestId('experience-card');

describe('ExperiencePicker', () => {
  it('shows the Neon Grid rides as one series card with a variant switch', () => {
    renderPicker();
    expect(screen.getAllByTestId('experience-card')).toHaveLength(1);
    expect(card().getAttribute('data-experience')).toBe('neon-grid-30'); // shortest first
    const variants = within(screen.getByRole('radiogroup', { name: 'Length and variant' }));
    expect(variants.getAllByRole('radio').map((r) => r.parentElement?.textContent)).toEqual([
      '30 min',
      'Light 45',
      '45 min',
    ]);
  });

  it('has no tags and no song count in a sentence; level, effort and songs are chips', () => {
    renderPicker();
    expect(card()).not.toHaveTextContent('electronic');
    const facts = within(card())
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(facts).toEqual(['Medium', 'effort 3–9', '7 songs']);
  });

  it('picking a variant changes the card to that ride', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: '45 min' }));
    expect(card().getAttribute('data-experience')).toBe('neon-grid-45');
    expect(card()).toHaveTextContent('Hard');
    expect(card()).toHaveTextContent('11 songs');
  });

  it('filters by level: a series stays while one of its variants fits, opening on it', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Easy' }));
    expect(screen.queryAllByTestId('experience-card')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    expect(card().getAttribute('data-experience')).toBe('neon-grid-45');
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    expect(card().getAttribute('data-experience')).toBe('neon-grid-30');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByTestId('experience-card')).toHaveLength(1);
  });

  it('shows the scenario on request, with a summary line and one row per song', () => {
    renderPicker();
    expect(screen.queryByTestId('experience-scenario')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '45 min' }));
    fireEvent.click(within(card()).getByRole('button', { name: 'Show scenario' }));
    expect(screen.getByTestId('experience-scenario-summary')).toHaveTextContent(
      '45 min · 11 songs · peak 9',
    );
    const rows = screen.getByTestId('experience-scenario').children;
    expect(rows.length).toBe(11);
    // m:ss, so the rows add up to the 45 minutes of the class
    expect(rows[0]).toHaveTextContent('5:00');
    expect(rows[0]).toHaveTextContent(/effort \d/);
    expect(rows[3]).toHaveTextContent('2:30');
    let sec = 0;
    for (const r of Array.from(rows)) {
      const [m, s] = (
        /(\d+):(\d\d)$/.exec(r.querySelector('[data-testid="scenario-time"]')?.textContent ?? '') ??
        []
      )
        .slice(1)
        .map(Number);
      sec += (m ?? 0) * 60 + (s ?? 0);
    }
    expect(sec).toBe(45 * 60);
  });

  it('switching the variant folds the scenario away', () => {
    renderPicker();
    fireEvent.click(within(card()).getByRole('button', { name: 'Show scenario' }));
    expect(screen.getByTestId('experience-scenario')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Light 45' }));
    expect(screen.queryByTestId('experience-scenario')).toBeNull();
  });

  it('Start opens Setup with the workout and the experience id of the chosen variant', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: '45 min' }));
    fireEvent.click(within(card()).getByTestId('experience-start'));
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/setup/class-neon-grid-45?exp=neon-grid-45',
    );
  });
});
