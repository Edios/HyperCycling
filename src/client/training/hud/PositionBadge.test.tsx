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

  it('highlights the position it is about to change to (R6)', () => {
    render(<PositionBadge position="seated" upcoming="standing" />);
    const badge = screen.getByTestId('position-badge');
    expect(badge).toHaveAttribute('data-upcoming', 'standing');
    expect(badge).toHaveAttribute('data-animated', 'true');
    // The change is announced to assistive tech too, without changing the current position.
    expect(badge).toHaveAttribute('data-position', 'seated');
    expect(badge).toHaveAccessibleName(/seated.*standing/i);
  });

  it('counts down to the change in both languages (R4b)', () => {
    const { rerender } = render(<PositionBadge position="seated" upcoming="standing" inSec={5} />);
    expect(screen.getByTestId('position-badge')).toHaveTextContent('Standing in 5 s');
    expect(screen.getByTestId('position-badge')).toHaveAccessibleName(/in 5 s/);
    setLang('pl');
    rerender(<PositionBadge position="seated" upcoming="standing" inSec={5} />);
    expect(screen.getByTestId('position-badge')).toHaveTextContent('Stojąc za 5 s');
  });

  it('shows no highlight when no change is coming', () => {
    render(<PositionBadge position="seated" />);
    const badge = screen.getByTestId('position-badge');
    expect(badge).not.toHaveAttribute('data-upcoming');
    expect(badge).not.toHaveAttribute('data-animated');
  });

  it('keeps the highlight but does not animate it under reduced motion', () => {
    render(<PositionBadge position="seated" upcoming="standing" reducedMotion />);
    const badge = screen.getByTestId('position-badge');
    expect(badge).toHaveAttribute('data-upcoming', 'standing');
    expect(badge).not.toHaveAttribute('data-animated');
  });
});
