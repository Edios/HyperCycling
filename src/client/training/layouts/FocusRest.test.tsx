import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TrainingView } from '../view';
import { FocusBadge, FocusRest } from './FocusRest';

const view = {
  effort: 7,
  ftpPct: 92,
  labelKey: 'hard',
  color: '#ffd23f',
  remainingSec: 161,
  durationSec: 300,
} as unknown as TrainingView;

describe('FocusRest', () => {
  it('shows the ring, the name and the time while active', () => {
    render(<FocusRest view={view} active reducedMotion={false} />);
    const root = screen.getByTestId('focus-rest');
    expect(root).toHaveAttribute('data-active', 'true');
    expect(root).not.toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('focus-rest-effort')).toHaveTextContent('07');
    expect(root).toHaveTextContent('Hard · ~92% FTP');
    expect(root).toHaveTextContent('2:41');
  });

  it('fades in over 700 ms (the HUD leaves) and out over 180 ms', () => {
    const { rerender } = render(<FocusRest view={view} active reducedMotion={false} />);
    expect(screen.getByTestId('focus-rest').style.transitionDuration).toBe('700ms, 0ms');
    rerender(<FocusRest view={view} active={false} reducedMotion={false} />);
    expect(screen.getByTestId('focus-rest')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('focus-rest').style.transitionDuration).toBe('180ms, 0ms');
  });

  it('switches instantly with reduced motion or Effects off', () => {
    render(<FocusRest view={view} active reducedMotion />);
    expect(screen.getByTestId('focus-rest').style.transitionDuration).toBe('0ms, 0ms');
  });
});

describe('FocusBadge', () => {
  it('is a small glass panel with the ring and the time', () => {
    render(<FocusBadge view={view} active reducedMotion={false} />);
    const badge = screen.getByTestId('focus-badge');
    expect(badge).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('focus-badge-effort')).toHaveTextContent('07');
    expect(badge).toHaveTextContent('2:41');
  });

  it('is hidden from assistive tech while the HUD is shown', () => {
    render(<FocusBadge view={view} active={false} reducedMotion={false} />);
    expect(screen.getByTestId('focus-badge')).toHaveAttribute('aria-hidden', 'true');
  });
});
