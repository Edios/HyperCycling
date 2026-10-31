import { act, fireEvent, render, screen } from '@testing-library/react';
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
import { layoutKindOf, nextLayout } from './overlay-layouts';

let stored: Settings | undefined;
vi.mock('../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      settings: { get: () => Promise.resolve(stored), put: () => Promise.resolve() },
    }),
}));

interface CanvasProps {
  quality: string;
  world?: string;
  viewOffsetX?: number;
  onSway?: (x: number, y: number) => void;
  onUnavailable?: () => void;
}
const canvas = vi.hoisted(() => ({ last: undefined as unknown, mounts: 0 }));
vi.mock('../hyperride/HyperrideCanvas', () => ({
  HyperrideCanvas: (props: CanvasProps) => {
    canvas.last = props;
    canvas.mounts += 1;
    return <canvas data-testid="hyperride-canvas" />;
  },
}));
const lastCanvas = (): CanvasProps => canvas.last as CanvasProps;

const workout = {
  id: 'w1',
  name: 'Test ride',
  blocks: [
    { kind: 'steady', id: 'a', durationSec: 10, intensity: { effort: 3 }, rpm: 85 },
    { kind: 'steady', id: 'b', durationSec: 10, intensity: { effort: 7 }, rpm: 90 },
  ],
} as unknown as Workout;

const players: Player[] = [
  { id: 'p1', name: 'Mirek', ftp: 250 },
  { id: 'p2', name: 'Ania', ftp: 200 },
];

function load(hud: SessionConfig['hud'], withPlayers = false): void {
  const config: SessionConfig = { background: 'hyperride', hud, playerIds: [], music: false };
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
        <Route path="/summary" element={<div />} />
        <Route path="/" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('training-screen');
}

function key(code: string): void {
  act(() => {
    fireEvent.keyDown(window, { code, key: code });
  });
}

beforeEach(() => {
  stored = undefined;
  canvas.last = undefined;
  canvas.mounts = 0;
  resetSettingsForTests();
  useLastResult.getState().clear();
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  setSessionClock(() => 0);
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

const layouts = [
  ['immersive', 'layout-immersive'],
  ['column', 'layout-column'],
  ['cockpit', 'layout-cockpit'],
  ['tunnelTime', 'layout-tunnel'],
] as const;

describe('overlay layouts', () => {
  it.each(layouts)('%s shows the canvas and the HUD pieces', async (hud, testId) => {
    load(hud);
    await renderScreen();
    expect(screen.getByTestId('hyperride-canvas')).toBeInTheDocument();
    const layout = screen.getByTestId(testId);
    for (const id of ['effort-value', 'rpm-value', 'block-timer', 'next-block', 'timeline']) {
      expect(layout.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
    expect(layout.querySelector('[data-testid="players-list"]')).toBeNull();
    expect(screen.getByTestId('block-timer')).toHaveTextContent('0:10');
    expect(screen.getByTestId('effort-value')).toHaveTextContent('3');
  });

  it('passes the quality setting and no view offset by default', async () => {
    stored = { ...DEFAULT_SETTINGS, hyperrideQuality: 'low' };
    load('immersive');
    await renderScreen();
    expect(lastCanvas().quality).toBe('low');
    expect(lastCanvas().viewOffsetX).toBe(0);
  });

  it('passes the registered world and lets the quick settings pick another one live', async () => {
    stored = { ...DEFAULT_SETTINGS, hyperrideWorld: 'road' };
    load('immersive');
    await renderScreen();
    expect(lastCanvas().world).toBe('road');
    fireEvent.click(screen.getByRole('button', { name: 'Quick settings' }));
    expect(screen.getByRole('radio', { name: 'Road' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Neon tunnel' }));
    expect(screen.getByRole('radio', { name: 'Neon tunnel' })).toBeChecked();
    expect(lastCanvas().world).toBe('neon-tunnel');
  });

  it('Column without players offsets the view by 0.11, with players it does not', async () => {
    load('column', true);
    await renderScreen();
    expect(screen.getByTestId('players-list')).toBeInTheDocument();
    expect(lastCanvas().viewOffsetX).toBe(0);
    key('KeyG');
    expect(screen.queryByTestId('players-list')).toBeNull();
    expect(lastCanvas().viewOffsetX).toBe(0.11);
  });

  it('shows players in Immersive and G toggles them', async () => {
    load('immersive', true);
    await renderScreen();
    expect(screen.getByTestId('players-list')).toHaveTextContent('Mirek');
    key('KeyG');
    expect(screen.queryByTestId('players-list')).toBeNull();
    key('KeyG');
    expect(screen.getByTestId('players-list')).toBeInTheDocument();
  });

  it('H cycles all five layouts, Focus included', async () => {
    load('immersive');
    await renderScreen();
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const focus = screen.queryByTestId('focus-layer') !== null;
      seen.push(focus ? 'focus' : (screen.getByTestId(/^layout-/).dataset['layout'] ?? ''));
      key('KeyH');
    }
    expect(seen).toEqual(['immersive', 'column', 'cockpit', 'tunnel', 'focus']);
    expect(screen.getByTestId('layout-immersive')).toBeInTheDocument();
  });

  it('Focus keeps its HUD visible before the ride starts', async () => {
    load('focus');
    await renderScreen();
    expect(screen.getByTestId('focus-layer')).toHaveAttribute('data-hud-visible', 'true');
    expect(screen.getByTestId('layout-immersive')).toBeInTheDocument();
  });

  it('H does not skip any layout while players are shown; they show where there is room', async () => {
    load('immersive', true);
    await renderScreen();
    key('KeyH');
    expect(screen.getByTestId('layout-column')).toBeInTheDocument();
    expect(screen.getByTestId('players-list')).toBeInTheDocument();
    key('KeyH');
    expect(screen.getByTestId('layout-cockpit')).toBeInTheDocument();
    expect(screen.queryByTestId('players-list')).toBeNull();
    key('KeyH');
    key('KeyH');
    expect(screen.getByTestId('focus-layer')).toBeInTheDocument();
    expect(screen.getByTestId('players-list')).toBeInTheDocument();
    key('KeyH');
    expect(screen.getByTestId('layout-immersive')).toBeInTheDocument();
  });

  it('turning players on in Cockpit moves to Immersive', async () => {
    load('cockpit', true);
    await renderScreen();
    // Cockpit has no room for the riders panel: showing the riders switches to Immersive.
    expect(screen.queryByTestId('players-list')).toBeNull();
    key('KeyG');
    expect(screen.getByTestId('layout-immersive')).toBeInTheDocument();
    expect(screen.getByTestId('players-list')).toBeInTheDocument();
  });

  it('falls back to the dark Basic layout with a notice when WebGL is unavailable', async () => {
    load('immersive');
    await renderScreen();
    act(() => lastCanvas().onUnavailable?.());
    expect(screen.queryByTestId('hyperride-canvas')).toBeNull();
    expect(screen.getByTestId('layout-solo')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('WebGL');
    expect(screen.getByTestId('training-screen').dataset['theme']).toBe('dark');
    key('KeyH'); // no overlay layouts any more
    expect(screen.getByTestId('layout-solo')).toBeInTheDocument();
  });

  it('does not sway when effects are off', async () => {
    stored = { ...DEFAULT_SETTINGS, effectsIntensity: 0 };
    load('immersive');
    await renderScreen();
    expect(lastCanvas().onSway).toBeUndefined();
  });

  it('sways through CSS variables when effects are on', async () => {
    load('immersive');
    await renderScreen();
    const onSway = lastCanvas().onSway;
    expect(onSway).toBeDefined();
    act(() => onSway?.(5.4, -3));
    const root = screen.getByTestId('training-screen');
    expect(root.style.getPropertyValue('--sx')).toBe('5.4px');
    expect(root.style.getPropertyValue('--sy')).toBe('-3.0px');
  });
});

describe('overlay layout rules', () => {
  it('maps stored huds and cycles through every layout', () => {
    expect(layoutKindOf('solo', 'hyperride')).toBe('immersive');
    expect(layoutKindOf('cockpit', 'hyperride')).toBe('cockpit');
    expect(nextLayout('column', 'hyperride')).toBe('cockpit');
    expect(nextLayout('focus', 'hyperride')).toBe('immersive');
  });
});
