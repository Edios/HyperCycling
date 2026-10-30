import { useNavigate } from 'react-router-dom';
import { flattenWorkout } from '../../domain/segments';
import type { Player } from '../../domain/player';
import type { SessionConfig } from '../../domain/settings';
import { totalDurationSec, type Workout } from '../../domain/workout';
import { builtinWorkouts } from '../data/builtin';
import { useSettings } from '../data/useSettings';
import { useLang, useT } from '../i18n';
import { formatClock } from '../training/format';
import { useSessionStore } from '../training/session-store';

/** Temporary entry point until the select screens arrive (M5). */
const DEMO_PLAYERS: Player[] = [
  { id: 'demo-1', name: 'Mirek', ftp: 270, isMe: true },
  { id: 'demo-2', name: 'Ania', ftp: 190 },
];

/** One very long block, so e2e can check that big clock values such as "59:59" fit their tile. */
function longBlockWorkout(durationSec: number): Workout {
  const name = `Long block ${formatClock(durationSec)}`;
  return {
    id: `dev-long-${durationSec}`,
    name,
    description: 'Dev only: a single long block.',
    category: 'freestyle',
    tags: ['dev'],
    source: { kind: 'builtin' },
    blocks: [
      { kind: 'steady', id: 'long', durationSec, intensity: { effort: 5 }, rpm: 90 },
      { kind: 'steady', id: 'after', durationSec: 30, intensity: { effort: 7 }, rpm: 95 },
    ],
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const DEV_WORKOUTS: Workout[] = [
  ...builtinWorkouts,
  longBlockWorkout(3599),
  longBlockWorkout(3600),
];

export function DevHome() {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings, loaded } = useSettings();

  const ride = (workout: Workout, withPlayers: boolean): void => {
    const players = withPlayers ? DEMO_PLAYERS : [];
    const config: SessionConfig = {
      background: 'basic',
      hud: withPlayers ? 'players' : 'solo',
      playerIds: players.map((p) => p.id),
      music: false,
    };
    useSessionStore.getState().load({
      workout,
      segments: flattenWorkout(workout, settings.effortTable),
      config,
      players,
    });
    navigate('/train');
  };

  return (
    <main data-testid="app-shell">
      <h1>{t('app.title')}</h1>
      <h2>{t('dev.title')}</h2>
      <ul>
        {DEV_WORKOUTS.map((w) => (
          <li key={w.id} data-testid="workout-row">
            <span>{w.localized?.[lang]?.name ?? w.name}</span>{' '}
            <span>{formatClock(totalDurationSec(w))}</span>{' '}
            <button type="button" disabled={!loaded} onClick={() => ride(w, false)}>
              {t('dev.ride')}
            </button>{' '}
            <button type="button" disabled={!loaded} onClick={() => ride(w, true)}>
              {t('dev.rideWithPlayers')}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
