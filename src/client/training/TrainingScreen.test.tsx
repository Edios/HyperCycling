import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: { get: () => Promise.resolve(stored), put: () => Promise.resolve() },
    }),
}));

const workout = {
  id: 'w1',
  name: 'Test ride',
  blocks: [
    { kind: 'steady', id: 'a', durationSec: 10, intensity: { effort: 3 }, rpm: 85 },
    { kind: 'steady', id: 'b', durationSec: 10, intensity: { effort: 7 }, rpm: 90 },
    { kind: 'steady', id: 'c', durationSec: 10, intensity: { effort: 3 } },
  ],
} as unknown as Workout;

const players: Player[] = [
  { id: 'p1', name: 'Mirek', ftp: 250 },
  { id: 'p2', name: 'Ania', ftp: 200 },
];

let now = 0;

function load(hud: SessionConfig['hud'] = 'solo', withPlayers = false): void {
  const config: SessionConfig = { background: 'basic', hud, playerIds: [], music: false };
  useSessionStore.getState().load({
    workout,
    segments: flattenWorkout(workout),
    config,
    players: withPlayers ? players : [],
  });
}

async function renderScreen() {
  const utils = render(
    <MemoryRouter initialEntries={['/train']}>
      <Routes>
        <Route path="/train" element={<TrainingScreen />} />
        <Route path="/summary" element={<div data-testid="summary-page" />} />
        <Route path="/" element={<div data-testid="home-page" />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('training-screen').catch(() => undefined);
  return utils;
}

/** Moves the fake clock and ticks the engine once, like one animation frame would. */
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

beforeEach(() => {
  now = 0;
  stored = undefined;
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

describe('TrainingScreen', () => {
  it('redirects home when no session is loaded', async () => {
    await renderScreen();
    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
  });

  it('shows the first block and a Start prompt while idle', async () => {
    load();
    await renderScreen();
    expect(await screen.findByTestId('layout-solo')).toBeInTheDocument();
    expect(screen.getByTestId('effort-value')).toHaveTextContent('3');
    expect(screen.getByTestId('block-timer')).toHaveTextContent('0:10');
    expect(screen.getByText('Press Space or click Start')).toBeInTheDocument();
  });

  it('Space starts a 3-2-1 countdown, then runs; a second Space pauses', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    expect(screen.getByTestId('training-screen').dataset['status']).toBe('countdown');
    expect(screen.getByTestId('countdown')).toHaveTextContent('3');
    advance(1000);
    expect(screen.getByTestId('countdown')).toHaveTextContent('2');
    advance(2100);
    expect(screen.getByTestId('training-screen').dataset['status']).toBe('running');
    advance(2000);
    key('Space');
    expect(screen.getByTestId('training-screen').dataset['status']).toBe('paused');
    const frozen = screen.getByTestId('block-timer').textContent;
    advance(5000);
    expect(screen.getByTestId('block-timer').textContent).toBe(frozen);
  });

  it('Space during the countdown cancels back to idle', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    key('Space');
    expect(screen.getByTestId('training-screen').dataset['status']).toBe('idle');
  });

  it('shows the coach cue and flashes when the block changes', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    advance(3100);
    advance(10_000);
    expect(screen.getByTestId('effort-value')).toHaveTextContent('7');
    expect(screen.getByTestId('coach-overlay')).toHaveTextContent('ATTACK!');
    expect(screen.getByTestId('edge-flash').dataset['active']).toBe('true');
  });

  it('does not show cues when coach is off', async () => {
    stored = { ...DEFAULT_SETTINGS, coach: false };
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    advance(3100);
    advance(10_000);
    expect(screen.queryByTestId('coach-overlay')).toBeNull();
  });

  it('ArrowRight and ArrowLeft move between blocks', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    advance(3100);
    key('ArrowRight');
    expect(screen.getByTestId('effort-value')).toHaveTextContent('7');
    key('ArrowLeft');
    expect(screen.getByTestId('effort-value')).toHaveTextContent('3');
  });

  it('M toggles mute', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('KeyM');
    expect(useSessionStore.getState().muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Escape pauses and opens the end dialog; Resume continues', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    advance(3100);
    key('Escape');
    expect(screen.getByRole('dialog')).toHaveTextContent('End workout?');
    expect(useSessionStore.getState().state.status).toBe('paused');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resume' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useSessionStore.getState().state.status).toBe('running');
  });

  it('Escape during the countdown cancels it; Resume returns to the Start prompt', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    expect(screen.getByTestId('training-screen').dataset['status']).toBe('countdown');
    key('Escape');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(useSessionStore.getState().state.status).toBe('idle');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resume' }));
    expect(useSessionStore.getState().state.status).toBe('idle');
    expect(screen.getByText('Press Space or click Start')).toBeInTheDocument();
  });

  it('leaving the route without ending pauses the session and keeps the runtime', async () => {
    load();
    const { unmount } = await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    advance(3100);
    unmount();
    expect(useSessionStore.getState().state.status).toBe('paused');
    expect(useSessionStore.getState().runtime).toBeDefined();
  });

  it('ending stores the result and goes to the summary', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    advance(3100);
    advance(4000);
    key('Escape');
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(await screen.findByTestId('summary-page')).toBeInTheDocument();
    const r = useLastResult.getState().result;
    expect(r?.completed).toBe(false);
    expect(r?.workout.id).toBe('w1');
    expect(r?.riddenSec).toBeGreaterThan(3);
    expect(r?.riddenSec).toBeLessThan(5);
    expect(useSessionStore.getState().runtime).toBeUndefined();
  });

  it('finishing goes to the summary as completed', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    advance(3100);
    advance(30_500);
    expect(await screen.findByTestId('summary-page')).toBeInTheDocument();
    expect(useLastResult.getState().result).toMatchObject({ completed: true, riddenSec: 30 });
  });

  it('hideRpmTile gives two tiles', async () => {
    stored = {
      ...DEFAULT_SETTINGS,
      equipment: { ...DEFAULT_SETTINGS.equipment, hideRpmTile: true },
    };
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    expect(screen.queryByTestId('rpm-value')).toBeNull();
  });

  it('players layout lists watts for each player, and G toggles it', async () => {
    load('players', true);
    await renderScreen();
    await screen.findByTestId('layout-players');
    const list = screen.getByTestId('players-list');
    // effort 3 = 62 % FTP: 250 -> 155 W, 200 -> 124 W
    expect(list).toHaveTextContent('Mirek');
    expect(list).toHaveTextContent('155 W');
    expect(list).toHaveTextContent('124 W');
    key('KeyG');
    expect(screen.getByTestId('layout-solo')).toBeInTheDocument();
    key('KeyG');
    expect(screen.getByTestId('layout-players')).toBeInTheDocument();
  });

  it('players layout shows names only when the bike has no power', async () => {
    stored = {
      ...DEFAULT_SETTINGS,
      equipment: { ...DEFAULT_SETTINGS.equipment, showsWatts: false },
    };
    load('players', true);
    await renderScreen();
    await screen.findByTestId('layout-players');
    expect(screen.getByTestId('players-list')).not.toHaveTextContent('W');
  });

  it('G does nothing without players', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('KeyG');
    expect(screen.getByTestId('layout-solo')).toBeInTheDocument();
  });

  it('applies the light theme from settings', async () => {
    stored = { ...DEFAULT_SETTINGS, basicTheme: 'light' };
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    expect(screen.getByTestId('training-screen').dataset['theme']).toBe('light');
  });

  it('auto-hides the controls after 3 s without input while running', async () => {
    load();
    await renderScreen();
    await screen.findByTestId('layout-solo');
    key('Space');
    advance(3100);
    expect(screen.getByTestId('controls').dataset['hidden']).toBe('false');
    await waitFor(() => expect(screen.getByTestId('controls').dataset['hidden']).toBe('true'), {
      timeout: 4500,
    });
    expect(screen.getByTestId('training-screen').dataset['cursorHidden']).toBe('true');
    act(() => {
      fireEvent.mouseMove(window);
    });
    expect(screen.getByTestId('controls').dataset['hidden']).toBe('false');
  }, 8000);
});
