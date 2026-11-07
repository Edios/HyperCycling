import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TRAINING_SHORTCUTS } from '../training/keyboard';
import { ShortcutsCard } from './ShortcutsCard';

describe('ShortcutsCard', () => {
  it('lists every training shortcut with its key and description', () => {
    render(<ShortcutsCard />);
    const card = screen.getByTestId('shortcuts-card');
    expect(within(card).getByText('Keyboard shortcuts')).toBeInTheDocument();
    expect(within(card).getAllByRole('listitem')).toHaveLength(TRAINING_SHORTCUTS.length);
    expect(within(card).getByText('Space')).toBeInTheDocument();
    expect(within(card).getByText('Start, pause or resume')).toBeInTheDocument();
  });
});
