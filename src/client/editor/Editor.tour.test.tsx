import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      workouts: {
        get: () => Promise.resolve(undefined),
        put: () => Promise.resolve(),
        list: () => Promise.resolve([]),
      },
      settings: { get: () => Promise.resolve(undefined) },
      activeSession: { get: () => Promise.resolve(undefined) },
    }),
}));

import { setLang } from '../i18n';
import { EDITOR_TOUR_KEY, EDITOR_TOUR_STEPS } from './editor-tour';
import { EditorScreen } from './EditorScreen';

const TOTAL = EDITOR_TOUR_STEPS.length;

async function openNew() {
  const router = createMemoryRouter([{ path: '/editor/:workoutId', element: <EditorScreen /> }], {
    initialEntries: ['/editor/new'],
  });
  render(<RouterProvider router={router} />);
  await screen.findByTestId('editor-screen');
}

const stored = (): unknown => {
  const raw = localStorage.getItem(EDITOR_TOUR_KEY);
  return raw ? JSON.parse(raw) : null;
};

beforeEach(() => {
  setLang('en');
  localStorage.clear();
});

describe('editor tutorial', () => {
  it('has between five and seven short steps', () => {
    expect(TOTAL).toBeGreaterThanOrEqual(5);
    expect(TOTAL).toBeLessThanOrEqual(7);
  });

  it('opens by itself on the first visit', async () => {
    await openNew();
    expect(screen.queryByTestId('tour-bubble')).not.toBeInTheDocument();
    expect(await screen.findByTestId('tour-bubble')).toBeInTheDocument();
    expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step 1 of ${TOTAL}`);
  });

  it('does not open by itself once it has been seen', async () => {
    localStorage.setItem(EDITOR_TOUR_KEY, JSON.stringify({ outcome: 'skipped' }));
    await openNew();
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.queryByTestId('tour-bubble')).not.toBeInTheDocument();
  });

  it('walks through every step, then remembers it as done', async () => {
    localStorage.setItem(EDITOR_TOUR_KEY, JSON.stringify({ outcome: 'skipped' }));
    await openNew();
    fireEvent.click(screen.getByTestId('editor-help'));
    const bubble = await screen.findByTestId('tour-bubble');
    expect(screen.getByTestId('tour-back')).toBeDisabled();
    const seen: string[] = [];
    for (let i = 0; i < TOTAL; i += 1) {
      seen.push(bubble.getAttribute('data-step') ?? '');
      expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step ${i + 1} of ${TOTAL}`);
      fireEvent.click(screen.getByTestId('tour-next'));
    }
    expect(seen).toEqual(EDITOR_TOUR_STEPS.map((s) => s.id));
    expect(screen.queryByTestId('tour-bubble')).not.toBeInTheDocument();
    expect(stored()).toMatchObject({ outcome: 'done' });
  });

  it('offers Done on the last step, and Back returns to the previous one', async () => {
    await openNew();
    fireEvent.click(screen.getByTestId('editor-help'));
    await screen.findByTestId('tour-bubble');
    for (let i = 0; i < TOTAL - 1; i += 1) fireEvent.click(screen.getByTestId('tour-next'));
    expect(screen.getByTestId('tour-next')).toHaveTextContent('Done');
    fireEvent.click(screen.getByTestId('tour-back'));
    expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step ${TOTAL - 1} of ${TOTAL}`);
  });

  it('Skip closes it at once and remembers that', async () => {
    await openNew();
    fireEvent.click(screen.getByTestId('editor-help'));
    await screen.findByTestId('tour-bubble');
    fireEvent.click(screen.getByTestId('tour-skip'));
    expect(screen.queryByTestId('tour-bubble')).not.toBeInTheDocument();
    expect(stored()).toMatchObject({ outcome: 'skipped' });
  });

  it('works from the keyboard: arrows move, Esc skips', async () => {
    await openNew();
    fireEvent.click(screen.getByTestId('editor-help'));
    const bubble = await screen.findByTestId('tour-bubble');
    await waitFor(() => expect(screen.getByTestId('tour-next')).toHaveFocus());
    fireEvent.keyDown(bubble, { key: 'ArrowRight' });
    expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step 2 of ${TOTAL}`);
    fireEvent.keyDown(bubble, { key: 'ArrowLeft' });
    expect(screen.getByTestId('tour-count')).toHaveTextContent(`Step 1 of ${TOTAL}`);
    fireEvent.keyDown(bubble, { key: 'Escape' });
    expect(screen.queryByTestId('tour-bubble')).not.toBeInTheDocument();
  });

  it('is a labelled region and does not block editing', async () => {
    await openNew();
    fireEvent.click(screen.getByTestId('editor-help'));
    const bubble = await screen.findByTestId('tour-bubble');
    expect(bubble).toHaveAttribute('role', 'region');
    expect(bubble).toHaveAttribute('aria-labelledby');
    expect(bubble).toHaveAttribute('aria-describedby');
    expect(within(bubble).getByRole('heading')).toHaveTextContent('Your workout');
    const before = screen.getAllByTestId('editor-block').length;
    fireEvent.click(screen.getByTestId('palette-steady'));
    expect(screen.getAllByTestId('editor-block')).toHaveLength(before + 1);
    expect(screen.getByTestId('tour-bubble')).toBeInTheDocument();
  });

  it('still works when the stored flag cannot be read or written', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      await openNew();
      expect(await screen.findByTestId('tour-bubble')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('tour-skip'));
      expect(screen.queryByTestId('tour-bubble')).not.toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('speaks Polish in Polish', async () => {
    setLang('pl');
    try {
      await openNew();
      fireEvent.click(screen.getByTestId('editor-help'));
      await screen.findByTestId('tour-bubble');
      expect(screen.getByTestId('tour-count')).toHaveTextContent(`Krok 1 z ${TOTAL}`);
      expect(screen.getByTestId('tour-skip')).toHaveTextContent('Pomiń');
    } finally {
      setLang('en');
    }
  });
});
