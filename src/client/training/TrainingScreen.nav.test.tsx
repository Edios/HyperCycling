import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../../domain/player';
import { flattenWorkout } from '../../domain/segments';
import { DEFAULT_SETTINGS, type Settings, type SessionConfig } from '../../domain/settings';
import type { Workout } from '../../domain/workout';
import { resetSettingsForTests } from '../data/useSettings';
import { useLastResult } from './last-result';
import {
  configureSessionSideEffects,
  resetSessionClock,
  setSessionClock,
  useSessionStore,
} from './session-store';
import { TrainingScreen } from './TrainingScreen';

let stored: Settings | undefined;
const puts = vi.hoisted(() => [] as Settings[]);
const failPuts = vi.hoisted(() => ({ value: false }));
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: {
        get: () => Promise.resolve(stored),
        put: (s: Settings) => {
          puts.push(s);
          return failPuts.value ? Promise.reject(new Error('disk full')) : Promise.resolve();
        },
      },
    }),
}));
vi.mock('../hyperride/HyperrideCanvas', () => ({
  HyperrideCanvas: () => <canvas data-testid="hyperride-canvas" />,
}));
vi.mock('../youtube/YouTubeBackground', () => ({
  YouTubeBackground: () => <div data-testid="youtube-background" />,
}));

const workout = {
  id: 'w1',
  name: 'Test ride',
  blocks: [
    { kind: 'steady', id: 'a', durationSec: 60, intensity: { effort: 3 }, rpm: 85 },
    { kind: 'steady', id: 'b', durationSec: 60, intensity: { effort: 7 }, rpm: 90 },
  ],
} as unknown as Workout;

const players: Player[] = [
  { id: 'p1', name: 'Mirek', ftp: 250 },
  { id: 'p2', name: 'Ania', ftp: 200 },
];

let now = 0;

function load(over: Partial<SessionConfig> = {}, withPlayers = false): void {
  const config: SessionConfig = {
    background: 'basic',
    hud: 'solo',
    playerIds: [],
    music: false,
    ...over,
  };
  useSessionStore.getState().load({
    workout,
    segments: flattenWorkout(workout),
    config,
    players: withPlayers ? players : [],
  });
}

async function renderScreen() {
  render(
    <MemoryRouter initialEntries={['/train']}>
      <Routes>
        <Route path="/train" element={<TrainingScreen />} />
        <Route path="/summary" element={<div data-testid="summary-page" />} />
        <Route path="/" element={<div data-testid="home-page" />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('training-screen');
}

function advance(ms: number): void {
  now += ms;
  act(() => {
    useSessionStore.getState().tick();
  });
}

function key(code: string): void {
  act(() => {
    fireEvent.keyDown(window, { code, key: code });
  });
}

/** Starts the ride and pauses it 10 s in. */
function rideThenPause(): void {
  key('Space');
  advance(3100);
  advance(10_000);
  key('Space');
}

const bgOf = () => screen.getByTestId('training-screen').dataset['background'];

beforeEach(() => {
  now = 0;
  stored = undefined;
  puts.length = 0;
  failPuts.value = false;
  resetSettingsForTests();
  useLastResult.getState().clear();
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  setSessionClock(() => now);
  configureSessionSideEffects({
    wakeLock: { acquire: async () => undefined, release: async () => undefined },
    save: async () => undefined,
    clear: async () => undefined,
  });
});

afterEach(() => {
  useSessionStore.getState().stop();
  configureSessionSideEffects(null);
  resetSessionClock();
  vi.unstubAllGlobals();
});

describe('exit dialog', () => {
  it('the Menu button pauses and offers end, leave and cancel', async () => {
    load();
    await renderScreen();
    key('Space');
    advance(3100);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const dialog = screen.getByRole('dialog');
    expect(useSessionStore.getState().state.status).toBe('paused');
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['End and see summary', 'Leave without saving', 'Cancel']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(useSessionStore.getState().state.status).toBe('running');
  });

  it('Leave without saving goes home, drops the session and stores no result', async () => {
    load();
    await renderScreen();
    key('Space');
    advance(3100);
    advance(4000);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
    expect(useSessionStore.getState().runtime).toBeUndefined();
    expect(useLastResult.getState().result).toBeUndefined();
  });

  it('Tab cycles through the three buttons', async () => {
    load();
    await renderScreen();
    key('Escape');
    const dialog = screen.getByRole('dialog');
    const names = ['Cancel', 'End and see summary', 'Leave without saving'];
    expect(document.activeElement).toHaveTextContent(names[0] as string);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toHaveTextContent(names[1] as string);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toHaveTextContent(names[2] as string);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toHaveTextContent(names[0] as string);
  });
});

describe('quick settings', () => {
  it('opens from the gear while paused; Escape closes it before it asks to leave', async () => {
    load();
    await renderScreen();
    rideThenPause();
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    expect(screen.getByTestId('quick-settings')).toBeInTheDocument();
    key('Escape');
    expect(screen.queryByTestId('quick-settings')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    key('Escape');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('switching background keeps the session time and state, and is saved', async () => {
    stored = {
      ...DEFAULT_SETTINGS,
      lastSession: { background: 'basic', hud: 'solo', playerIds: [], music: true },
    };
    load();
    await renderScreen();
    rideThenPause();
    const before = useSessionStore.getState().state;
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hyperride' }));
    expect(bgOf()).toBe('hyperride');
    expect(screen.getByTestId('hyperride-canvas')).toBeInTheDocument();
    expect(useSessionStore.getState().state).toEqual(before);
    expect(useSessionStore.getState().state.workoutElapsedSec).toBeGreaterThan(9);
    expect(useSessionStore.getState().runtime?.config.background).toBe('hyperride');
    expect(useSessionStore.getState().runtime?.config.hud).toBe('immersive');
    expect(puts).toEqual([]); // this ride only: the saved defaults stay
    // Resuming carries on from the same second.
    key('Space');
    advance(1000);
    expect(useSessionStore.getState().state.workoutElapsedSec).toBeCloseTo(
      before.workoutElapsedSec + 1,
      1,
    );
  });

  it('offers only the layouts valid for the background', async () => {
    load({}, true);
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    const layouts = () =>
      within(screen.getByRole('radiogroup', { name: 'Screen layout' }))
        .getAllByRole('radio')
        .map((r) => (r.parentElement as HTMLElement).textContent);
    expect(layouts()).toEqual(['Solo', 'With players']);
    fireEvent.click(screen.getByRole('radio', { name: 'With players' }));
    expect(screen.getByTestId('layout-players')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Hyperride' }));
    expect(layouts()).toEqual(['Immersive', 'Column']);
    fireEvent.click(screen.getByRole('radio', { name: 'Column' }));
    expect(useSessionStore.getState().runtime?.config.hud).toBe('column');
  });

  it('YouTube needs a link: disabled without one, available from the recent links', async () => {
    load();
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    expect(screen.getByRole('radio', { name: 'YouTube video' })).toBeDisabled();
  });

  it('YouTube from the latest recent link', async () => {
    stored = { ...DEFAULT_SETTINGS, recentYoutubeUrls: ['https://youtu.be/dQw4w9WgXcQ'] };
    load();
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    fireEvent.click(screen.getByRole('radio', { name: 'YouTube video' }));
    expect(bgOf()).toBe('youtube');
    expect(useSessionStore.getState().runtime?.config.youtubeUrl).toBe(
      'https://youtu.be/dQw4w9WgXcQ',
    );
  });

  it('beeps and cues apply to this ride only and never touch the saved defaults', async () => {
    load();
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Beeps' }));
    expect(screen.getByRole('switch', { name: 'Beeps' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('switch', { name: 'On-screen cues' }));
    expect(useSessionStore.getState().runtime?.options).toEqual({
      sounds: !DEFAULT_SETTINGS.sounds,
      coach: !DEFAULT_SETTINGS.coach,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(puts).toEqual([]);
  });

  it('shows why YouTube is unavailable as visible text', async () => {
    load();
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    expect(screen.getByTestId('quick-youtube-hint')).toHaveTextContent(/YouTube link/);
  });
});

describe('focus and Space (QA F2, F3)', () => {
  it('closing the quick settings gives focus back to the gear', async () => {
    load();
    await renderScreen();
    rideThenPause();
    const gear = screen.getByRole('button', { name: 'Quick settings' });
    gear.focus();
    fireEvent.click(gear);
    expect(gear).not.toHaveFocus();
    key('Escape');
    expect(gear).toHaveFocus();
  });

  it('cancelling the exit dialog gives focus back to the Menu button', async () => {
    load();
    await renderScreen();
    rideThenPause();
    const menu = screen.getByRole('button', { name: 'Menu' });
    menu.focus();
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(menu).toHaveFocus();
  });

  it('Space pauses even when "Next block" has focus, and does not skip the block', async () => {
    load();
    await renderScreen();
    key('Space');
    advance(3100);
    advance(2000);
    const next = screen.getByRole('button', { name: 'Next block' });
    next.focus();
    const down = new KeyboardEvent('keydown', {
      code: 'Space',
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      next.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    expect(useSessionStore.getState().state.status).toBe('paused');
    expect(useSessionStore.getState().state.segmentIndex).toBe(0);
  });

  it('opening the quick settings puts focus on its first control, not on Close', async () => {
    load();
    await renderScreen();
    rideThenPause();
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    const panel = screen.getByTestId('quick-settings');
    expect(panel).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(within(panel).getByRole('button', { name: 'Close' }));
    expect(document.activeElement?.tagName).toBe('INPUT');
  });

  it('Space inside the quick settings resumes the ride and does not toggle the focused control', async () => {
    load();
    await renderScreen();
    rideThenPause();
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    const beeps = screen.getByRole('switch', { name: 'Beeps' });
    beeps.focus();
    const checked = (beeps as HTMLInputElement).checked;
    const down = new KeyboardEvent('keydown', {
      code: 'Space',
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      beeps.dispatchEvent(down);
    });
    const up = new KeyboardEvent('keyup', {
      code: 'Space',
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      beeps.dispatchEvent(up);
    });
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(useSessionStore.getState().state.status).toBe('running');
    expect((beeps as HTMLInputElement).checked).toBe(checked);
  });

  it('shows the Space hint once when the quick settings are open while paused', async () => {
    load();
    await renderScreen();
    rideThenPause();
    expect(screen.getAllByText('Space: pause / resume')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    expect(screen.getAllByText('Space: pause / resume')).toHaveLength(1);
  });

  it('shows the Space shortcut hint while paused', async () => {
    load();
    await renderScreen();
    rideThenPause();
    expect(screen.getByRole('status')).toHaveTextContent('Space: pause / resume');
  });
});
