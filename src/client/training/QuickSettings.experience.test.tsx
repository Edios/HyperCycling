import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../i18n';
import { QuickSettings, type QuickSettingsProps } from './QuickSettings';
import { layoutChoices, nextLayout } from './overlay-layouts';
import { effectiveLayout, layoutOptions } from '../setup/model';

afterEach(() => setLang('en'));

function props(over: Partial<QuickSettingsProps> = {}): QuickSettingsProps {
  return {
    background: 'hyperride',
    youtubeAvailable: false,
    layout: 'immersive',
    layoutChoices: layoutChoices('hyperride', true),
    riders: false,
    world: 'scenes',
    sounds: true,
    coach: true,
    onBackground: vi.fn(),
    onLayout: vi.fn(),
    onRiders: vi.fn(),
    onWorld: vi.fn(),
    onSounds: vi.fn(),
    onCoach: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

describe('QuickSettings, music player switch', () => {
  it('is offered only when the ride has music, in the normal and the Experience panel', () => {
    const { rerender } = render(<QuickSettings {...props()} />);
    expect(screen.queryByRole('switch', { name: 'Music player' })).toBeNull();
    const onMusicPlayer = vi.fn();
    rerender(<QuickSettings {...props({ musicPlayer: true, onMusicPlayer })} />);
    const toggle = screen.getByRole('switch', { name: 'Music player' });
    expect(toggle).toBeChecked();
    expect(screen.getByTestId('quick-player-hint')).toHaveTextContent('own risk');
    fireEvent.click(toggle);
    expect(onMusicPlayer).toHaveBeenLastCalledWith(false);
    rerender(<QuickSettings {...props({ experience: true, musicPlayer: false, onMusicPlayer })} />);
    expect(screen.getByRole('switch', { name: 'Music player' })).not.toBeChecked();
  });

  it('speaks Polish', () => {
    setLang('pl');
    render(<QuickSettings {...props({ musicPlayer: true, onMusicPlayer: vi.fn() })} />);
    expect(screen.getByRole('switch', { name: 'Odtwarzacz muzyki' })).toBeChecked();
  });
});

describe('QuickSettings in an Experience', () => {
  it('offers only the HUD layout and the Lite switch', () => {
    render(<QuickSettings {...props({ experience: true })} />);
    const panel = screen.getByTestId('quick-settings');
    expect(within(panel).getAllByRole('radio')).toHaveLength(5);
    expect(within(panel).getAllByRole('switch')).toHaveLength(1);
    expect(within(panel).getByRole('switch', { name: 'Lite (weaker device)' })).not.toBeChecked();
    for (const gone of ['Basic', 'World', 'YouTube', 'Beeps', 'Show riders']) {
      expect(within(panel).queryByText(new RegExp(gone, 'i'))).toBeNull();
    }
  });

  it('Lite switches to the plain background and back', () => {
    const onBackground = vi.fn();
    const { rerender } = render(<QuickSettings {...props({ experience: true, onBackground })} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Lite (weaker device)' }));
    expect(onBackground).toHaveBeenLastCalledWith('basic');
    rerender(<QuickSettings {...props({ experience: true, onBackground, background: 'basic' })} />);
    expect(screen.getByRole('switch', { name: 'Lite (weaker device)' })).toBeChecked();
    fireEvent.click(screen.getByRole('switch', { name: 'Lite (weaker device)' }));
    expect(onBackground).toHaveBeenLastCalledWith('hyperride');
  });

  it('speaks Polish', () => {
    setLang('pl');
    render(<QuickSettings {...props({ experience: true })} />);
    expect(screen.getByRole('switch', { name: 'Lite (słabsze urządzenie)' })).toBeInTheDocument();
  });

  it('the regular menu keeps the background choice', () => {
    render(<QuickSettings {...props({ layoutChoices: layoutChoices('hyperride') })} />);
    expect(screen.getByText('Background')).toBeInTheDocument();
  });
});

describe('Experience layouts', () => {
  it('never offer the tiled Classic layout, also in Lite', () => {
    expect(layoutChoices('basic', true)).toEqual([
      'immersive',
      'column',
      'cockpit',
      'tunnelTime',
      'focus',
    ]);
    expect(layoutChoices('basic')).toContain('classic');
    expect(nextLayout('focus', 'basic', true)).toBe('immersive');
    expect(effectiveLayout('basic', undefined, true)).toBe('immersive');
    expect(effectiveLayout('basic', 'classic', true)).toBe('immersive');
    expect(layoutOptions('basic', true).map((o) => o.value)).not.toContain('classic');
  });
});
