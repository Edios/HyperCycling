import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../../../domain/player';
import type { Segment } from '../../../domain/segments';
import { DEFAULT_SETTINGS, type Settings } from '../../../domain/settings';

const db = vi.hoisted(() => ({
  players: [] as Player[],
  settings: undefined as Settings | undefined,
}));

vi.mock('../../data/repositories', () => ({
  getRepositories: () =>
    Promise.resolve({
      players: { list: () => Promise.resolve(db.players) },
      settings: { get: () => Promise.resolve(db.settings), put: () => Promise.resolve() },
    }),
}));

import { resetSettingsForTests } from '../../data/useSettings';
import { HrTarget } from './HrTarget';
import { PlayersList } from './PlayersList';

function seg(durationSec: number, effort = 6): Segment {
  return {
    index: 0,
    startSec: 0,
    durationSec,
    kind: 'steady',
    ftpPctStart: 85,
    ftpPctEnd: 85,
    effortStart: effort,
    effortEnd: effort,
    blockId: 'b0',
    rep: 1,
    reps: 1,
  };
}

const me = (hrMax?: number): Player => ({
  id: 'me',
  name: 'Me',
  ftp: 200,
  isMe: true,
  ...(hrMax !== undefined ? { hrMax } : {}),
});

beforeEach(() => {
  db.players = [];
  db.settings = undefined;
  resetSettingsForTests();
});

describe('HrTarget', () => {
  it('shows the bpm band when HRmax is known', async () => {
    db.players = [me(183)];
    render(<HrTarget segment={seg(300)} elapsedInSegSec={10} />);
    expect(await screen.findByText('Z3 · 128–146 bpm')).toBeInTheDocument();
  });

  it('shows percentages without HRmax once the setting is on', async () => {
    db.players = [me()];
    db.settings = { ...DEFAULT_SETTINGS, showHrZones: true };
    render(<HrTarget segment={seg(300)} elapsedInSegSec={10} />);
    expect(await screen.findByText('Z3 · 70–80 % HRmax')).toBeInTheDocument();
  });

  it('renders nothing for a 30-second block', async () => {
    db.players = [me(183)];
    render(<HrTarget segment={seg(30)} elapsedInSegSec={5} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('hr-target')).toBeNull();
  });

  it('renders nothing when the setting is off', async () => {
    db.players = [me(183)];
    db.settings = { ...DEFAULT_SETTINGS, showHrZones: false };
    render(<HrTarget segment={seg(300)} elapsedInSegSec={10} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('hr-target')).toBeNull();
  });
});

describe('PlayersList heart rate', () => {
  it('shows a rider bpm band only for riders with an HRmax', async () => {
    db.players = [me(183)];
    const riders: Player[] = [
      { id: 'k', name: 'Kasia', ftp: 180, hrMax: 190 },
      { id: 'o', name: 'Ola', ftp: 180 },
    ];
    render(
      <PlayersList
        players={riders}
        ftpPct={75}
        effort={6}
        showsWatts
        hr={{ segment: seg(300), elapsedInSegSec: 10 }}
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId('player-hr')).toHaveLength(1));
    expect(screen.getByTestId('player-hr')).toHaveTextContent('133–152 bpm');
  });
});
