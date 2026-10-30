import { formatClock } from '../training/format';
import type { Workout } from '../../domain/workout';

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
      { kind: 'steady', id: 'long', durationSec, intensity: { effort: 10 }, rpm: 90 },
      { kind: 'steady', id: 'after', durationSec: 30, intensity: { effort: 7 }, rpm: 95 },
    ],
    musicCues: [],
    fallbackPlaylist: [],
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Long single-block workouts for checking that big clock values fit their tiles ("59:59", "1:00:00"). */
export const longBlockWorkouts: Workout[] = [longBlockWorkout(3599), longBlockWorkout(3600)];
