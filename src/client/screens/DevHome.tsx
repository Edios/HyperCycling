import { useEffect, useState } from 'react';
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

export function DevHome() {
  const t = useT();
  const [lang] = useLang();
  const navigate = useNavigate();
  const { settings, loaded } = useSettings();
  const [extra, setExtra] = useState<Workout[]>([]);
  useEffect(() => {
    // Inline condition so Vite folds it away (and drops the chunk) in production builds.
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') {
      void import('./dev-fixtures').then((m) => setExtra(m.longBlockWorkouts));
    }
  }, []);

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
        {[...builtinWorkouts, ...extra].map((w) => (
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
