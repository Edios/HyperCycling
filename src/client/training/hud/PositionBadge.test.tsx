import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { PositionBadge } from './PositionBadge';

afterEach(() => setLang('en'));

describe('PositionBadge', () => {
  it('shows an icon and the word for standing', () => {
    render(<PositionBadge position="standing" />);
    const badge = screen.getByTestId('position-badge');
    expect(badge).toHaveAttribute('data-position', 'standing');
    expect(badge).toHaveTextContent('Standing');
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge).toHaveAccessibleName(/standing/i);
  });

  it('shows the Polish words', () => {
    setLang('pl');
    const { rerender } = render(<PositionBadge position="standing" />);
    expect(screen.getByTestId('position-badge')).toHaveTextContent('Stojąc');
    rerender(<PositionBadge position="seated" />);
    expect(screen.getByTestId('position-badge')).toHaveTextContent('Siedząc');
  });

  it('never prints undefined for a missing position and falls back to seated', () => {
    render(<PositionBadge position={undefined} />);
    const badge = screen.getByTestId('position-badge');
    expect(badge).toHaveAttribute('data-position', 'seated');
    expect(badge.textContent ?? '').not.toMatch(/undefined/);
  });
});
