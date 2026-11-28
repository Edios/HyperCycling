/**
 * TCX (Garmin Training Center Database v2) -> RawRide: every Trackpoint's time, position,
 * altitude, distance, heart rate and cadence, plus speed and watts from the ActivityExtension
 * (`TPX`), the laps and the sport. Pauses show as gaps in time; the normalisation finds them.
 */

import type { RawLap, RawRide, RawSample, RideReadResult, RideSport } from './types';
import {
  attr,
  child,
  children,
  deepNumber,
  numberOf,
  parseXml,
  textOf,
  timeOf,
  type XmlNode,
} from './xml';

function sportOf(sport: string | undefined): RideSport | undefined {
  const s = sport?.toLowerCase();
  if (s === undefined) return undefined;
  if (s === 'biking') return 'cycling';
  if (s === 'running') return 'running';
  return 'other';
}

function toSample(tp: XmlNode, time: number): RawSample {
  const s: RawSample = { t: time };
  const pos = child(tp, 'Position');
  const lat = numberOf(textOf(child(pos, 'LatitudeDegrees')));
  const lon = numberOf(textOf(child(pos, 'LongitudeDegrees')));
  const altitude = numberOf(textOf(child(tp, 'AltitudeMeters')));
  const distance = numberOf(textOf(child(tp, 'DistanceMeters')));
  const heartRate = numberOf(textOf(child(child(tp, 'HeartRateBpm'), 'Value')));
  const ext = child(tp, 'Extensions');
  const cadence = numberOf(textOf(child(tp, 'Cadence'))) ?? deepNumber(ext, ['RunCadence']);
  const speed = deepNumber(ext, ['Speed']);
  const power = deepNumber(ext, ['Watts']);
  if (lat !== undefined && lon !== undefined) {
    s.lat = lat;
    s.lon = lon;
  }
  if (altitude !== undefined) s.altitude = altitude;
  if (distance !== undefined) s.distance = distance;
  if (heartRate !== undefined) s.heartRate = heartRate;
  if (cadence !== undefined) s.cadence = cadence;
  if (speed !== undefined) s.speed = speed;
  if (power !== undefined) s.power = power;
  return s;
}

export function readTcxRide(text: string): RideReadResult {
  const doc = parseXml(text);
  const db = child(doc, 'TrainingCenterDatabase');
  if (!db) return { ok: false, error: { code: 'xmlInvalid' } };
  // A file may hold several activities; the first one is the ride.
  const activity = child(child(db, 'Activities'), 'Activity');
  if (!activity) {
    // Courses and workouts are plans, not rides.
    const plan = child(db, 'Courses') ?? child(db, 'Workouts');
    return { ok: false, error: { code: plan ? 'notARide' : 'noSamples' } };
  }

  const samples: RawSample[] = [];
  const laps: RawLap[] = [];
  let untimed = 0;
  for (const lap of children(activity, 'Lap')) {
    const start = timeOf(attr(lap, 'StartTime'));
    const total = numberOf(textOf(child(lap, 'TotalTimeSeconds')));
    if (start !== undefined && total !== undefined && total >= 0) {
      laps.push({ start, end: start + total * 1000 });
    }
    for (const track of children(lap, 'Track')) {
      for (const tp of children(track, 'Trackpoint')) {
        const time = timeOf(textOf(child(tp, 'Time')));
        if (time === undefined) untimed += 1;
        else samples.push(toSample(tp, time));
      }
    }
  }
  if (samples.length === 0) return { ok: false, error: { code: 'noSamples' } };
  samples.sort((a, b) => a.t - b.t);

  const sport = sportOf(attr(activity, 'Sport'));
  const device = textOf(child(child(activity, 'Creator'), 'Name'));
  const ride: RawRide = {
    format: 'tcx',
    samples,
    timer: [],
    laps,
    meta: {
      ...(sport ? { sport } : {}),
      startedAt: timeOf(textOf(child(activity, 'Id'))) ?? samples[0]?.t ?? 0,
      ...(device && /garmin|edge|forerunner|fenix/i.test(device) ? { device: 'Garmin' } : {}),
    },
    hints: {},
  };
  const warnings: ('samplesWithoutTime' | 'notCycling')[] = [];
  if (untimed > 0) warnings.push('samplesWithoutTime');
  if (sport === 'running' || sport === 'other') warnings.push('notCycling');
  return { ok: true, ride, warnings };
}
