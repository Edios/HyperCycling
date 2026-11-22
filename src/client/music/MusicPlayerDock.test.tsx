import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackRef } from '../../domain/workout';
import { setLang } from '../i18n';
import { MusicPlayerDock } from './MusicPlayerDock';

afterEach(() => setLang('en'));

const yt: TrackRef = {
  provider: 'youtube',
  id: 'abcdefghijk',
  title: 'Nightcall',
  artist: 'Kavinsky',
  startAtSec: 0,
};

function dock(props: Partial<Parameters<typeof MusicPlayerDock>[0]> = {}) {
  const slotRef = createRef<HTMLDivElement>();
  const utils = render(<MusicPlayerDock track={yt} shown slotRef={slotRef} {...props} />);
  return { slotRef, ...utils };
}

describe('MusicPlayerDock', () => {
  it('shows the player with the title and the artist while a YouTube track plays', () => {
    const { slotRef } = dock();
    const el = screen.getByTestId('music-dock');
    expect(el).toHaveAttribute('data-visible', 'true');
    expect(el).not.toHaveAttribute('aria-hidden');
    expect(screen.getByTestId('music-player-name')).toHaveTextContent('Nightcall');
    expect(screen.getByTestId('music-player-name')).toHaveTextContent('Kavinsky');
    // The slot is where the provider mounts YouTube's player: nothing of React's inside it.
    expect(slotRef.current).toBe(screen.getByTestId('music-player-slot'));
    expect(slotRef.current?.children).toHaveLength(0);
  });

  it('is parked, not removed, when the rider hid it, nothing plays or the track is Spotify', () => {
    const { rerender, slotRef } = dock({ shown: false });
    const el = screen.getByTestId('music-dock');
    expect(el).toHaveAttribute('data-visible', 'false');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('music-player-slot')).toBeInTheDocument();
    rerender(<MusicPlayerDock track={null} shown slotRef={slotRef} />);
    expect(screen.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
    rerender(<MusicPlayerDock track={{ ...yt, provider: 'spotify' }} shown slotRef={slotRef} />);
    expect(screen.getByTestId('music-dock')).toHaveAttribute('data-visible', 'false');
  });

  it('keeps the same slot element while it is shown and hidden (the iframe is never moved)', () => {
    const { rerender, slotRef } = dock();
    const slot = screen.getByTestId('music-player-slot');
    slot.appendChild(document.createElement('iframe'));
    rerender(<MusicPlayerDock track={yt} shown={false} slotRef={slotRef} />);
    expect(screen.getByTestId('music-player-slot')).toBe(slot);
    expect(slot.querySelector('iframe')).not.toBeNull();
    rerender(<MusicPlayerDock track={{ ...yt, title: 'Next' }} shown slotRef={slotRef} />);
    expect(screen.getByTestId('music-player-slot')).toBe(slot);
    expect(slot.querySelector('iframe')).not.toBeNull();
  });

  it('has a hide button only when it is given a handler, and says what it does', () => {
    const { rerender, slotRef } = dock();
    expect(screen.queryByTestId('music-player-hide')).toBeNull();
    const onHide = vi.fn();
    rerender(<MusicPlayerDock track={yt} shown slotRef={slotRef} onHide={onHide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide the music player' }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('keeps the hide button out of the tab order while parked, and speaks Polish', () => {
    setLang('pl');
    dock({ shown: false, onHide: vi.fn() });
    expect(screen.getByTestId('music-player-hide')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('music-dock')).toHaveAttribute('aria-label', 'Odtwarzacz muzyki');
  });
});
