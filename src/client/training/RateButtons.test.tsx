import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../i18n';
import { RateButtons } from './RateButtons';

afterEach(cleanup);

describe('RateButtons', () => {
  it('shows the thumbs and the heart pressed as rated, and passes each tap on', () => {
    setLang('en');
    const onRate = vi.fn();
    render(<RateButtons feedback={{ rating: 'up', love: true }} onRate={onRate} />);
    expect(screen.getByRole('group', { name: /Rate this song/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Good fit' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Poor fit' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Poor fit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }));
    expect(onRate.mock.calls).toEqual([['down'], ['love']]);
  });
});
